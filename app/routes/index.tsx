import { redirect } from 'react-router';
import { initialPresentationPath } from '../lib/presentation/location';

export function loader() {
  return redirect(initialPresentationPath);
}

export default function IndexRoute() {
  return null;
}
