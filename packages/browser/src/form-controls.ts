import type { BrowserContext, Locator } from "playwright";

export async function installReadOnlyFormRoutes(
  context: BrowserContext,
  onBlockedWrite: () => void,
) {
  await context.route("**/*", async (route) => {
    if (["GET", "HEAD"].includes(route.request().method())) return route.fallback();
    onBlockedWrite();
    return route.fulfill({ status: 409, body: "Read-only preparation blocked this request." });
  });
}

export async function fillAndReadNativeControl(
  control: Locator,
  kind: string,
  expected: string | boolean,
) {
  if ((await control.count()) !== 1 || !(await control.isVisible()) || !(await control.isEnabled()))
    throw new Error("Form control is missing, ambiguous, hidden or disabled.");
  const actualKind = await control.evaluate((element) =>
    element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase(),
  );
  if (
    actualKind !== kind ||
    !["text", "email", "tel", "textarea", "select", "checkbox"].includes(kind)
  )
    throw new Error("Form control type changed or is unsupported.");
  if ((kind === "checkbox") !== (typeof expected === "boolean"))
    throw new Error("Form value type does not match the control.");
  let actual: string | boolean;
  if (kind === "checkbox") {
    await control.setChecked(expected as boolean);
    actual = await control.isChecked();
  } else if (kind === "select") {
    const value = expected as string;
    if (
      !(await control.evaluate(
        (element, target) =>
          element instanceof HTMLSelectElement &&
          !element.multiple &&
          [...element.options].filter(
            (option) =>
              option.value === target &&
              !option.disabled &&
              !option.parentElement?.hasAttribute("disabled"),
          ).length === 1,
        value,
      ))
    )
      throw new Error("Form selection is unavailable or ambiguous.");
    await control.selectOption(value);
    actual = await control.inputValue();
  } else {
    await control.fill(expected as string);
    actual = await control.inputValue();
  }
  return { actual, matches: actual === expected };
}
