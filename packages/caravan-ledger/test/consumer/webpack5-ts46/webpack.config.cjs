const path = require("node:path");

module.exports = {
  context: __dirname,
  devtool: false,
  entry: "./compiled/index.js",
  experiments: {
    outputModule: true,
  },
  mode: "production",
  optimization: {
    minimize: true,
  },
  output: {
    clean: true,
    filename: "consumer.mjs",
    library: {
      type: "module",
    },
    module: true,
    path: path.resolve(__dirname, "bundle"),
  },
  performance: {
    hints: false,
  },
  resolve: {
    conditionNames: ["browser", "import", "module", "default"],
    extensions: [".js", ".mjs"],
    mainFields: ["browser", "module", "main"],
  },
  target: ["web", "es2018"],
};
