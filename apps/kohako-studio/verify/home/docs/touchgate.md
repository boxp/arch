# touchgate.mjs

`touchgate.mjs` は BFF を完全にモックし、平常時はなでると接触 event を 1 回送り、読み上げ中やなでた直後に録音を始めた場合は送らないことを確かめます（`node touchgate.mjs`、token 不要）。
