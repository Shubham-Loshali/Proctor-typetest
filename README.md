# Proctor-typetest
https://gehu.in/typesprint


## Deploying on Render (notes for a live event)

- Set **Health Check Path** to `/healthz`.
- The free plan sleeps after ~15 min idle and the first visit then takes up to a minute to wake it. Before the event, open the site (or ping `/healthz` with UptimeRobot every 5 min) so it is awake.
- Set the environment variable `ADMIN_PASS` to your own password.
- Game state lives in memory: a redeploy or restart wipes players and results. Download `results.csv` after each round and do not deploy during the event.
- The free plan has a small shared CPU. This version is tuned for it, but for a big live crowd (100+) the cheapest reliable option is switching the instance to **Starter** for the day (about a dollar for the day if prorated) and back afterwards.
- Load test: `node test/bots.js 100 https://YOUR-APP.onrender.com JOINCODE` (start a round from /admin while it runs).
