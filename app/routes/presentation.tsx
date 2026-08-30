import { redirect } from 'react-router';
import { initialPresentationPath } from '../lib/presentation/location';

/**
 * Presentation-level entry: deterministically lands on the canonical deck's
 * valid initial slide, where the workspace and its registered WebMCP tools load.
 */
export function loader() {
  return redirect(initialPresentationPath);
}

export default function PresentationRoute() {
  return null;
}
