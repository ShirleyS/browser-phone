ALTER TABLE public.bp_events ADD COLUMN delivery_state text NOT NULL DEFAULT 'retryable', ADD COLUMN lease_id uuid, ADD COLUMN lease_until timestamptz, ADD COLUMN response_json jsonb, ADD COLUMN response_status int, ADD COLUMN request_json jsonb;
UPDATE public.bp_events SET delivery_state = 'retryable';
CREATE OR REPLACE FUNCTION public.bp_insert_message(_session_id uuid, _external_id text, _direction text, _type text, _text text, _link jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE n bigint; BEGIN
 PERFORM 1 FROM bp_sessions WHERE id=_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'session not found'; END IF;
 SELECT seq INTO n FROM bp_messages WHERE session_id=_session_id AND direction=_direction AND external_id=_external_id;
 IF FOUND THEN RETURN jsonb_build_object('seq',n,'duplicate',true); END IF;
 INSERT INTO bp_messages(session_id,external_id,direction,type,text,link) VALUES(_session_id,_external_id,_direction,_type,_text,_link) RETURNING seq INTO n;
 RETURN jsonb_build_object('seq',n,'duplicate',false);
END $$;
-- All inserts, including direct administrative writers, lock BEFORE bigserial allocation.
CREATE OR REPLACE FUNCTION public.bp_lock_message_session() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN PERFORM 1 FROM bp_sessions WHERE id=NEW.session_id FOR UPDATE; RETURN NEW; END $$;
-- BEFORE INSERT defaults are evaluated before row triggers, so forbid direct inserts instead.
REVOKE INSERT ON public.bp_messages FROM service_role;
CREATE OR REPLACE FUNCTION public.bp_claim_event(_session_id uuid,_event_id text,_type text,_request jsonb,_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE e bp_events; BEGIN
 INSERT INTO bp_events(session_id,event_id,type,request_json) VALUES(_session_id,_event_id,_type,_request) ON CONFLICT DO NOTHING;
 SELECT * INTO e FROM bp_events WHERE session_id=_session_id AND event_id=_event_id FOR UPDATE;
 IF e.type <> _type OR (e.request_json IS NOT NULL AND e.request_json <> _request) THEN RETURN jsonb_build_object('conflict',true); END IF;
 IF e.delivery_state='succeeded' THEN RETURN jsonb_build_object('cached',true,'response',e.response_json,'status',e.response_status); END IF;
 IF e.delivery_state='pending' AND e.lease_until > now() THEN RETURN jsonb_build_object('pending',true); END IF;
 UPDATE bp_events SET delivery_state='pending',lease_id=_lease,lease_until=now()+interval '30 seconds',request_json=_request WHERE session_id=_session_id AND event_id=_event_id;
 RETURN jsonb_build_object('claimed',true);
END $$;
CREATE OR REPLACE FUNCTION public.bp_finish_event(_session_id uuid,_event_id text,_lease uuid,_ok boolean,_response jsonb,_status int) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 UPDATE bp_events SET delivery_state=CASE WHEN _ok THEN 'succeeded' ELSE 'retryable' END,response_json=_response,response_status=_status,lease_until=NULL WHERE session_id=_session_id AND event_id=_event_id AND lease_id=_lease AND delivery_state='pending';
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.bp_verify_pairing(_connection_id uuid,_candidate_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE c bp_connections; stamp timestamptz:=now(); BEGIN
 SELECT * INTO c FROM bp_connections WHERE id=_connection_id FOR UPDATE;
 IF NOT FOUND OR c.revoked_at IS NOT NULL OR c.token_expires_at<=stamp THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
 IF c.verified_at IS NOT NULL THEN RETURN jsonb_build_object('verified_at',c.verified_at); END IF;
 IF c.pairing_code_hash IS NULL OR c.pairing_expires_at<=stamp THEN RETURN jsonb_build_object('error','pairing_expired'); END IF;
 IF c.pairing_attempts>=5 THEN RETURN jsonb_build_object('error','too_many_attempts'); END IF;
 IF c.pairing_code_hash<>_candidate_hash THEN UPDATE bp_connections SET pairing_attempts=pairing_attempts+1 WHERE id=_connection_id; RETURN jsonb_build_object('error','invalid_code','attempts_left',4-c.pairing_attempts); END IF;
 UPDATE bp_connections SET verified_at=stamp,pairing_code_hash=NULL WHERE id=_connection_id;
 RETURN jsonb_build_object('verified_at',stamp);
END $$;
REVOKE ALL ON FUNCTION public.bp_insert_message,public.bp_claim_event,public.bp_finish_event,public.bp_verify_pairing,public.bp_lock_message_session FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bp_insert_message,public.bp_claim_event,public.bp_finish_event,public.bp_verify_pairing TO service_role;
COMMENT ON COLUMN public.bp_sessions.callback_token IS 'Recoverable callback secret used for signed webhook signaling; service-role only, expires with session. Database backups require secret-grade protection.';
COMMENT ON COLUMN public.bp_connections.signing_secret IS 'Recoverable HMAC signing secret; service-role only. Database backups require secret-grade protection.';