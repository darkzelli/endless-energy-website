// The Supabase Edge Functions that sell Radial Keys (supabase/functions). Empty until the project exists:
// the Buy buttons then fall back to email.
export const FUNCTIONS_URL = 'https://jgoqxotdwmzylpfzklqq.supabase.co/functions/v1'

export const BUY_URL = FUNCTIONS_URL
  ? `${FUNCTIONS_URL}/checkout`
  : 'mailto:management@bywhatevermedium.com?subject=Buy%20Radial%20Keys'
