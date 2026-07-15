import KeyRound from 'lucide-react/dist/esm/icons/key-round.mjs'
import Lock from 'lucide-react/dist/esm/icons/lock.mjs'
import Network from 'lucide-react/dist/esm/icons/network.mjs'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.mjs'

import type { AuthProviderId } from '../api/auth-provider-types'

/**
 * Recognizable ~22px icon per auth provider for the "app store" cards.
 *
 * The brand marks below are intentionally simple, brand-approximate inline
 * SVGs (a few paths each) — enough to be recognizable at a glance. Swap in the
 * exact official brand SVGs later without touching the call sites; the public
 * export shape stays `authProviderIcon(id) => ReactNode`.
 */

const SIZE = 22

function GoogleIcon(): React.ReactNode {
  // Multi-color Google "G"
  return (
    <svg aria-hidden="true" height={SIZE} viewBox="0 0 48 48" width={SIZE}>
      <path
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44c11 0 20-9 20-20 0-1.3-.1-2.3-.4-3.5z"
        fill="#FFC107"
      />
      <path
        d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"
        fill="#FF3D00"
      />
      <path
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.6 5.1A20 20 0 0 0 24 44z"
        fill="#4CAF50"
      />
      <path
        d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C39.9 35.6 44 30.4 44 24c0-1.3-.1-2.3-.4-3.5z"
        fill="#1976D2"
      />
    </svg>
  )
}

function MicrosoftIcon(): React.ReactNode {
  // Microsoft 4-square (used for azure-ad + active-directory)
  return (
    <svg aria-hidden="true" height={SIZE} viewBox="0 0 24 24" width={SIZE}>
      <rect fill="#F25022" height="10" width="10" x="1" y="1" />
      <rect fill="#7FBA00" height="10" width="10" x="13" y="1" />
      <rect fill="#00A4EF" height="10" width="10" x="1" y="13" />
      <rect fill="#FFB900" height="10" width="10" x="13" y="13" />
    </svg>
  )
}

function GithubIcon(): React.ReactNode {
  // GitHub mark
  return (
    <svg aria-hidden="true" fill="currentColor" height={SIZE} viewBox="0 0 24 24" width={SIZE}>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  )
}

function OktaIcon(): React.ReactNode {
  // Okta circular "O"
  return (
    <svg aria-hidden="true" height={SIZE} viewBox="0 0 24 24" width={SIZE}>
      <circle cx="12" cy="12" fill="none" r="9" stroke="#007DC1" strokeWidth="5" />
    </svg>
  )
}

function Auth0Icon(): React.ReactNode {
  // Auth0 shield with "A"
  return (
    <svg aria-hidden="true" height={SIZE} viewBox="0 0 24 24" width={SIZE}>
      <path d="M12 2l8 3v6c0 5-3.4 8.5-8 11-4.6-2.5-8-6-8-11V5l8-3z" fill="#EB5424" />
      <path d="M12 6.5l1.7 5h-3.4L12 6.5zm-3 8.5l1.1-3.3h3.8L15 15l-3-2.2L9 15z" fill="#fff" />
    </svg>
  )
}

function KeycloakIcon(): React.ReactNode {
  // Keycloak-approximate mark
  return (
    <svg aria-hidden="true" height={SIZE} viewBox="0 0 24 24" width={SIZE}>
      <path d="M6 3h6l3 4.5-3 4.5 3 4.5L12 21H6l-3-4.5V7.5L6 3z" fill="#008AAA" />
      <path d="M12 3h6l3 4.5v9L18 21h-6l3-4.5-3-4.5 3-4.5L12 3z" fill="#33A9C7" />
    </svg>
  )
}

/**
 * Returns the icon node for a provider id. Providers without a brand mark fall
 * back to a protocol-appropriate lucide glyph; unknown ids get a generic key.
 */
export function authProviderIcon(id: AuthProviderId): React.ReactNode {
  switch (id) {
    case 'google':
      return <GoogleIcon />
    case 'github':
      return <GithubIcon />
    case 'azure-ad':
    case 'active-directory':
      return <MicrosoftIcon />
    case 'okta':
      return <OktaIcon />
    case 'auth0':
      return <Auth0Icon />
    case 'keycloak':
      return <KeycloakIcon />
    case 'local':
      return <Lock aria-hidden="true" size={SIZE} />
    case 'ldap':
      return <Network aria-hidden="true" size={SIZE} />
    case 'saml':
      return <ShieldCheck aria-hidden="true" size={SIZE} />
    case 'generic-oidc':
      return <KeyRound aria-hidden="true" size={SIZE} />
    default:
      return <KeyRound aria-hidden="true" size={SIZE} />
  }
}
