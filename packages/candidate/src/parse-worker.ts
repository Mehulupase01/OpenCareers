import { extractDocument } from "./extract.js";

globalThis.fetch = async () => {
  throw new Error("Document parsing cannot fetch remote resources.");
};
process.once("message", (value: unknown) => {
  void (async () => {
    try {
      const message = value as { bytes: Buffer; format: "pdf" | "docx" };
      const extraction = await extractDocument(Buffer.from(message.bytes), message.format);
      process.send?.({ ok: true, extraction }, () => process.disconnect?.());
    } catch {
      process.send?.({ ok: false }, () => process.disconnect?.());
    }
  })();
});
