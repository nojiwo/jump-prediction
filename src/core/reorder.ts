/** Move an existing ranked item without mutating the original ordering.
 * Out-of-range or invalid indexes leave the original ordering unchanged.
 * This is used for touch dragging and keyboard-accessible arrow controls.
 */
export function moveRankedItem<T>(items:readonly T[], from:number, to:number):T[]{
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=items.length||to>=items.length||from===to)return [...items];
  const copy=[...items];
  copy.splice(to,0,...copy.splice(from,1));
  return copy;
}
