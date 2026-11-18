[![news-image-20261117](https://make.fun/badge/news-image-20261117.svg)](https://make.fun/c/news-image-20261117)
[![rank](https://make.fun/badge/news-image-20261117/mmr9759/news-image-20261117-v2/rank.svg)](https://make.fun/c/news-image-20261117)
[![reward](https://make.fun/badge/news-image-20261117/mmr9759/news-image-20261117-v2/reward.svg)](https://make.fun/c/news-image-20261117)

# THE WORLD TODAY — Tuesday, 17 November 2026

A one-page newspaper front page summing up Tuesday 17 November 2026 in
40 stories from six continents: the Kerch Bridge struck again, Iran's drones
at the US radar in Bahrain, the US strike on Qeshm Island, Trump heading to
Shenzhen for the three-way meeting with Xi and Putin, plus a world map with
six flashpoints and the day's markets, tech and sport.

## How it works

`main.ts` draws the whole front page from scratch with Node's standard
library only — no network, no fonts, no image files. It rasterises a 5x7
bitmap font, draws the masthead, the two lead stories, a schematic world
map with numbered pins, six regional sections and an "Also today" strip,
then encodes a 1024x1024 PNG with `node:zlib`. The program is fully
deterministic: two runs write byte-identical files.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png` (1024x1024, under 1 MiB). In the grader the
program writes to `/output/entry.png`.

## Entry

- Competition: [news-image-20261117](https://make.fun/c/news-image-20261117)
- Title: THE WORLD TODAY — Tuesday, 17 November 2026: 40 stories, six continents, one front page
- License: MIT
