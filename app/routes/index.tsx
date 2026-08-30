import { redirect } from 'react-router';

const defaultSlidePath = '/workspace/webmcp-launch/presentation/deck-webmcp-launch/slide/slide-gap';

export function loader() {
  return redirect(defaultSlidePath);
}

export default function IndexRoute() {
  return null;
}
