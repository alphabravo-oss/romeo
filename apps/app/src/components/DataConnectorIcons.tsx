import FileUp from 'lucide-react/dist/esm/icons/file-up.mjs'
import Globe from 'lucide-react/dist/esm/icons/globe.mjs'
import Plug from 'lucide-react/dist/esm/icons/plug.mjs'
import Rss from 'lucide-react/dist/esm/icons/rss.mjs'

import type { DataConnectorType } from '../api/data-connector-types'

/**
 * Recognizable ~22px icon per data-connector type for the "app store" cards.
 *
 * GitHub and S3 use brand-approximate inline SVGs; the rest use protocol-
 * appropriate lucide glyphs. The public export shape stays
 * `dataConnectorIcon(type) => ReactNode`.
 */

const SIZE = 22

function GithubIcon(): React.ReactNode {
  return (
    <svg aria-hidden="true" fill="currentColor" height={SIZE} viewBox="0 0 24 24" width={SIZE}>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  )
}

function S3Icon(): React.ReactNode {
  // AWS S3 approximate "bucket"
  return (
    <svg aria-hidden="true" height={SIZE} viewBox="0 0 24 24" width={SIZE}>
      <path d="M5 4h14l-1.4 15.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8L5 4z" fill="#E25444" />
      <path d="M12 4h7l-1.4 15.2a2 2 0 0 1-2 1.8H12V4z" fill="#B0332A" opacity="0.5" />
    </svg>
  )
}

/**
 * Returns the icon node for a connector type. Unknown types get a generic plug.
 */
export function dataConnectorIcon(type: DataConnectorType): React.ReactNode {
  switch (type) {
    case 'local_import':
      return <FileUp aria-hidden="true" size={SIZE} />
    case 'website':
      return <Globe aria-hidden="true" size={SIZE} />
    case 'rss':
      return <Rss aria-hidden="true" size={SIZE} />
    case 'github':
      return <GithubIcon />
    case 's3':
      return <S3Icon />
    default:
      return <Plug aria-hidden="true" size={SIZE} />
  }
}
