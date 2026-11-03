// Fog City Talk settings.
// proxy: the address of your Claude proxy (the Cloudflare Worker URL, see docs/CLAUDE-CHANNEL.md).
// Leave it empty and the public site shows the talk channel as "off the air".
// When the page is served by server.py on localhost, the local proxy at /api/claude is used.
// The address is not a secret: the Worker also requires a passcode and only accepts calls from your site.
export const TALK = {
  proxy: '',
};
