const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  publicPath: process.env.NODE_ENV === 'production' ? '/llamadle/' : '/',
  // In production, nginx.conf proxies /llamadle/{game,guess,daily,count-tokens} to the
  // llamadle-api container, stripping the /llamadle prefix. Mirror that here so local dev
  // (`npm run serve`) talks to a local `server/` instance instead of the production API.
  devServer: {
    proxy: {
      '/llamadle': {
        target: 'http://localhost:3000',
        pathRewrite: { '^/llamadle': '' },
        // Silent by default (http-proxy-middleware doesn't log proxied requests unless told
        // to) — without this, "nothing shows up" here doesn't mean nothing was sent.
        logLevel: 'debug',
      },
    },
  },
})
