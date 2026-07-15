declare module 'lucide-react/dist/esm/icons/*.mjs' {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from 'react'

  interface DirectIconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
    size?: number | string
    absoluteStrokeWidth?: boolean
  }

  const Icon: ForwardRefExoticComponent<DirectIconProps & RefAttributes<SVGSVGElement>>
  export default Icon
}
