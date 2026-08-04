import { datadogRum } from '@datadog/browser-rum';
import { datadogLogs } from '@datadog/browser-logs';

const applicationId = import.meta.env.VITE_DD_RUM_APP_ID as string | undefined;
const clientToken = import.meta.env.VITE_DD_RUM_CLIENT_TOKEN as string | undefined;
const service = (import.meta.env.VITE_DD_SERVICE as string | undefined) ?? 'dd-health-check-ui';
const env = (import.meta.env.VITE_DD_ENV as string | undefined) ?? import.meta.env.MODE ?? 'development';
const version = (import.meta.env.VITE_DD_VERSION as string | undefined) ?? '1.0.0';
const site = (import.meta.env.VITE_DD_SITE as string | undefined) ?? 'datadoghq.com';

export function initDatadog() {
  if (!applicationId || !clientToken) {
    // RUM not configured — skip silently in development
    console.warn('Datadog RUM is not configured. Please set VITE_DD_RUM_APP_ID and VITE_DD_RUM_CLIENT_TOKEN environment variables.');
    return;
  }

  datadogLogs.init({
    clientToken,
    site,
    service,
    env,
    version,
    forwardErrorsToLogs: true,
    forwardConsoleLogs: ['error', 'warn'],
    sessionSampleRate: 100,
  });

  datadogRum.init({
    applicationId,
    clientToken,
    site,
    service,
    env,
    version,
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    defaultPrivacyLevel: 'mask-user-input',
    allowedTracingUrls: [
      // Correlate RUM sessions with backend APM traces
      { match: /\/api\//, propagatorTypes: ['datadog'] },
    ],
  });

  datadogRum.startSessionReplayRecording();
}
