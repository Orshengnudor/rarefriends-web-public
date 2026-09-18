import chartSnapshot from "./chart-snapshot.json";

export function PriceChart() {
  // Saved vector geometry keeps this chart identical across auction updates and reloads.
  return <div className="app-launch-chart">
    <svg viewBox="0 0 800 208" role="img" aria-label="Auction clearing price by block">
      <defs><pattern id="app-launch-chart-dither" patternUnits="userSpaceOnUse" width="4" height="4"><rect width="1" height="1" fill="currentColor" /><rect x="2" y="2" width="1" height="1" fill="currentColor" /></pattern></defs>
      {[40, 110, 180].map(row => <path key={row} d={`M24 ${row}H776`} stroke="currentColor" strokeDasharray="1 7" fill="none" />)}
      <path d={chartSnapshot.areaPath} fill="url(#app-launch-chart-dither)" />
      <path d={chartSnapshot.path} stroke="currentColor" strokeWidth="3" fill="none" />
      <rect x={chartSnapshot.markerX} y={chartSnapshot.markerY} width="8" height="8" fill="currentColor" />
    </svg>
    <div className="app-launch-chart-axis"><span>block {chartSnapshot.startBlock}</span><span>block {chartSnapshot.endBlock}</span></div>
  </div>;
}

