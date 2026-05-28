import {
  type ForecastComputeWorkerRequest,
  type ForecastComputeWorkerResponse,
  runForecastDailySeriesCompute,
} from "./forecastComputeShared";

self.onmessage = (event: MessageEvent<ForecastComputeWorkerRequest>) => {
  const { id, ...input } = event.data;
  try {
    const result = runForecastDailySeriesCompute(input);
    const response: ForecastComputeWorkerResponse = { id, ...result };
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "Forecast compute failed",
    });
  }
};

export {};
