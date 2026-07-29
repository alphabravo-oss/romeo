declare module "lucide-react/dist/esm/icons/*.mjs" {
  import type {
    ForwardRefExoticComponent,
    RefAttributes,
    SVGProps,
  } from "react";

  interface DirectIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
    absoluteStrokeWidth?: boolean;
    size?: number | string;
  }

  const Icon: ForwardRefExoticComponent<
    DirectIconProps & RefAttributes<SVGSVGElement>
  >;
  export default Icon;
}
