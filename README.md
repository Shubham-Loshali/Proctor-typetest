# Proctor-typetest
https://gehu.in/typesprint


## Deploying on Render (notes for a live event)

- Set **Health Check Path** to `/healthz`.
- The free plan sleeps after ~15 min idle and the first visit then takes up to a minute to wake it. Before the event, open the site (or ping `/healthz` with UptimeRobot every 5 min) so it is awake.
- Set the environment variable `ADMIN_PASS` to your own password.
- Game state lives in memory: a redeploy or restart wipes players and results. Download `results.csv` after each round and do not deploy during the event.
- The free plan has a small shared CPU. This version is tuned for it, but for a big live crowd (100+) the cheapest reliable option is switching the instance to **Starter** for the day (about a dollar for the day if prorated) and back afterwards.
- **Load test that measures lag** (run it a day before the event, against your live URL):
  `node test/loadtest.js --url https://YOUR-APP.onrender.com --code JOINCODE --n 100 --pass YOUR_ADMIN_PASS`
  It starts a round by itself and prints ping, join time, drops and a final VERDICT (SMOOTH / BORDERLINE / LAGGING).
- **Watch it live during the event:** the admin page has a "Server health" line (green = healthy, red = lagging). Stalls over 300 ms are also written to the Render logs.
- **Check a real phone:** open the player page with `?debug` at the end of the URL (for example `https://YOUR-APP.onrender.com/?debug`) to see that device's live ping in the corner.
