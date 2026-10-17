import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = buildApp(config, {
  serializers: {
    // the query string carries the token on /ws
    req: (req: { method: string; url: string }) => ({
      method: req.method,
      url: req.url.split('?')[0],
    }),
  },
});

app.listen({ port: config.port, host: '127.0.0.1' }).then(
  () =>
    console.log(
      `plugin-master: open ${config.webOrigins[0]}/?token=${config.token}`,
    ),
  (err) => {
    app.log.error(err);
    process.exit(1);
  },
);
