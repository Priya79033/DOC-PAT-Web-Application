const fleetStreams = new Set();

export function addFleetStream(res) {
  fleetStreams.add(res);
  res.on('close', () => fleetStreams.delete(res));
}

export function publishFleetUpdate(vehicleId) {
  const data = `data: ${JSON.stringify({ vehicleId, updatedAt: new Date().toISOString() })}\n\n`;
  for (const res of fleetStreams) {
    if (res.destroyed || res.writableEnded) { fleetStreams.delete(res); continue; }
    res.write(data);
  }
}
