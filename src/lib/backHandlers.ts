// Android back button: open overlays (e.g. the More sheet) register a handler
// here so the back button closes them before it navigates back.
type BackHandler = () => void;

const stack: BackHandler[] = [];

/** Registers a handler; returns a function that removes it. The newest runs first. */
export function pushBackHandler(handler: BackHandler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i !== -1) stack.splice(i, 1);
  };
}

/** Runs the newest handler, if any. Returns true when the back press was used. */
export function runBackHandler(): boolean {
  const handler = stack[stack.length - 1];
  if (!handler) return false;
  handler();
  return true;
}
