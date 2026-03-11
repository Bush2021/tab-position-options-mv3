export function pickLeftCandidate(tabs, closedIndex) {
  const leftTabs = tabs.filter((tab) => tab.index < closedIndex);
  if (leftTabs.length > 0) {
    return leftTabs.reduce((best, current) => {
      return current.index > best.index ? current : best;
    });
  }

  return tabs.length > 0 ? tabs[0] : null;
}
