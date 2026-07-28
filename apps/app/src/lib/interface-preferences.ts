export type Density = "comfortable" | "compact";
export type FontSize = "small" | "medium" | "large";

export function applyInterfacePreferences(input: {
  density: Density;
  fontSize: FontSize;
  reducedMotion: boolean;
}) {
  const root = document.documentElement;
  root.dataset.density = input.density;
  root.dataset.fontSize = input.fontSize;
  root.classList.toggle("reduce-motion", input.reducedMotion);
  localStorage.setItem("romeo:interface", JSON.stringify(input));
}

export function getInterfacePreferences(): {
  density: Density;
  fontSize: FontSize;
  reducedMotion: boolean;
} {
  try {
    const parsed = JSON.parse(
      localStorage.getItem("romeo:interface") ?? "{}",
    ) as Record<string, unknown>;
    return {
      density: parsed.density === "compact" ? "compact" : "comfortable",
      fontSize:
        parsed.fontSize === "small" || parsed.fontSize === "large"
          ? parsed.fontSize
          : "medium",
      reducedMotion: parsed.reducedMotion === true,
    };
  } catch {
    return { density: "comfortable", fontSize: "medium", reducedMotion: false };
  }
}
