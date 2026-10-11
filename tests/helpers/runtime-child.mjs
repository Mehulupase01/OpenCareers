import { appendFileSync } from "node:fs";

const timer = setInterval(() => undefined, 1000);
if (process.env.SYNTHETIC_SECRET) {
  console.log(
    JSON.stringify({
      err: { code: process.env.SYNTHETIC_SECRET },
      token: process.env.SYNTHETIC_SECRET,
    }),
  );
  console.log(JSON.stringify({ err: { code: "CONFIG_INVALID" } }));
}
let stopping = false;
const stop = () => {
  if (process.env.SYNTHETIC_IGNORE_SHUTDOWN === "1") return;
  if (stopping) return;
  stopping = true;
  if (process.env.SYNTHETIC_LIFECYCLE_FILE)
    appendFileSync(process.env.SYNTHETIC_LIFECYCLE_FILE, `${process.pid}\n`);
  clearInterval(timer);
  if (process.connected) process.disconnect();
};
process.on("message", (message) => {
  if (message?.type === "shutdown") stop();
});
process.on("disconnect", stop);
