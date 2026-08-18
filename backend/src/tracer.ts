// Must be imported before any other module so dd-trace can patch them
import tracer from 'dd-trace';

tracer.init({
  service: process.env.DD_SERVICE ?? 'dd-health-check-api',
  env: process.env.DD_ENV ?? process.env.NODE_ENV ?? 'development',
  version: process.env.DD_VERSION ?? '1.0.0',
  hostname: process.env.DD_AGENT_HOST ?? 'localhost',
  port: parseInt(process.env.DD_AGENT_PORT ?? '8136'),
  logInjection: true,
  runtimeMetrics: true,
  plugins: true,
  dogstatsd: {
    hostname: process.env.DD_AGENT_HOST ?? 'localhost',
    port: parseInt(process.env.DD_DOGSTATSD_PORT ?? '8125'),
  },
});

export default tracer;
