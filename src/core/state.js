const state = new Map();

export function setPortState(port, pid) {
  state.set(port, pid);
}

export function getPortState(port) {
  return state.get(port);
}

export function clearPortState(port) {
  state.delete(port);
}

export function getAllStates() {
  return Object.fromEntries(state);
}

export function hasPortChanged(port, currentPid) {
  const previousPid = state.get(port);
  return previousPid !== undefined && previousPid !== currentPid;
}

export function reset() {
  state.clear();
}

export default {
  setPortState,
  getPortState,
  clearPortState,
  getAllStates,
  hasPortChanged,
  reset,
};
