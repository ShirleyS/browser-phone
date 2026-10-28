import { createFileRoute } from '@tanstack/react-router';
import { SharedTestPhone } from '@/components/phone/SharedTestPhone';

export const Route = createFileRoute('/test/$id')({
  head: () => ({ meta: [
    { title: 'Shared test phone — Browser Phone' },
    { name: 'robots', content: 'noindex, nofollow' },
    { name: 'referrer', content: 'no-referrer' },
  ] }),
  component: TestPhone,
});

function TestPhone() {
  const { id } = Route.useParams();
  return <SharedTestPhone key={id} id={id} />;
}
