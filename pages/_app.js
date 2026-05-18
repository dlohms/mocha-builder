import '../styles/globals.css'
import Head from 'next/head'

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        {/* Primary meta */}
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Mocha Builder — AI App Builder</title>
        <meta name="description" content="Describe any app in plain English. Mocha builds it live using Claude AI. No code required." />

        {/* Favicon — simple emoji fallback */}
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>☕</text></svg>" />

        {/* Open Graph — controls how URL looks when shared on Slack, iMessage, Twitter, LinkedIn */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Mocha Builder — AI App Builder" />
        <meta property="og:description" content="Describe any app in plain English. Mocha builds it live using Claude AI. No code required." />
        <meta property="og:image" content="/og-image.png" />
        <meta property="og:url" content={process.env.NEXT_PUBLIC_SITE_URL || ''} />

        {/* Twitter card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Mocha Builder — AI App Builder" />
        <meta name="twitter:description" content="Describe any app in plain English. Mocha builds it live." />
        <meta name="twitter:image" content="/og-image.png" />

        {/* Prevent indexing until you're ready to go public */}
        {/* Remove this line when you want Google to index your site */}
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Component {...pageProps} />
    </>
  )
}
