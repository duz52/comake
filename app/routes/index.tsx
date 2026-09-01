import { redirect } from 'react-router';
import { workspacePath, CANONICAL_WORKSPACE_ID } from '../lib/presentation/location';

/**
 * Product entry. The root lands on the canonical workspace home, whose
 * loader lists persisted projects and whose action creates new ones.
 */
export function loader() {
  return redirect(workspacePath(CANONICAL_WORKSPACE_ID));
}

export default function IndexRoute() {
  return null;
}