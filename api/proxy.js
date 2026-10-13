// Vercel serverless function: /api/proxy?url=https://www.mphs.gov.my/...
// Fetches a page and sends it back WITHOUT the headers that block iframes.

// Only these sites can be proxied (prevents misuse). Add more if needed.
const ALLOWED_HOSTS = [
  "www.mphs.gov.my",
  "mphs.gov.my"
];

module.exports = async (req, res) => {
  let target;
  try {
    target = new URL(req.query.url);
  } catch (e) {
    return res.status(400).send("Invalid url");
  }
  if (!["http:", "https:"].includes(target.protocol) || !ALLOWED_HOSTS.includes(target.hostname)) {
    return res.status(403).send("Host not allowed. Add it to ALLOWED_HOSTS in api/proxy.js");
  }

  try {
    const upstream = await fetch(target.href, {
      redirect: "follow",
      headers: {
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
        "accept": req.headers["accept"] || "*/*",
        "accept-language": req.headers["accept-language"] || "en"
      }
    });

    const type = upstream.headers.get("content-type") || "application/octet-stream";
    res.status(upstream.status);
    res.setHeader("content-type", type);
    // NOTE: x-frame-options and content-security-policy are intentionally NOT forwarded.

    if (type.includes("text/html")) {
      let html = await upstream.text();

      // remove CSP/frame rules written inside the page
      html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");

      // make relative links/images/css load from the original site
      const inject =
        `<base href="${upstream.url}">` +
        `<script>document.addEventListener("click",function(e){` +
        `var a=e.target.closest&&e.target.closest("a");` +
        `if(a&&a.href&&/^https?:/.test(a.href)&&a.target!=="_blank"){` +
        `e.preventDefault();location.href="/api/proxy?url="+encodeURIComponent(a.href);}});</script>`;

      html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (m) => m + inject)
        : inject + html;

      return res.send(html);
    }

    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    return res.status(502).send("Could not load the page: " + err.message);
  }
};
