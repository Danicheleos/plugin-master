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
  () => {
    const webPort = config.webOrigins[0]?.split(':').pop();
    console.log(
      `plugin-master: open ${config.webOrigins[0]}/?token=${config.token}`,
    );
    for (const ip of config.lanIps ?? [])
      console.log(
        `plugin-master (LAN): open http://${ip}:${webPort}/?token=${config.token}`,
      );
    if (config.lanIps?.length)
      console.warn(
        "WARNING: anyone on the network with the token gets an agent with access to this machine's files and commands.",
      );
  },
  (err) => {
    app.log.error(err);
    process.exit(1);
  },
);
