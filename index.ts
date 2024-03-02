import parseHTML from "node-html-parser";
import { readFile, writeFile } from "fs/promises";
import dayjs from "dayjs";

export async function getCurrencyRates() {
  const res = await fetch(
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json"
  );

  if (res.status !== 200) {
    throw new Error(`Currencies error: ${await res.text()}`);
  }

  return Object.fromEntries(
    Object.entries((await res.json()).usd).filter((i) =>
      ["amd", "rub", "eur"].includes(i[0])
    )
  ) as { amd: number; rub: number; eur: number };
}

export enum District {
  Ачапняк = 2,
  Арабкир = 3,
  Аван = 4,
  Давидашен = 5,
  Эребуни = 6,
  "Зейтун Канакер" = 7,
  Кентрон = 8,
  "Малатия Себастия" = 9,
  "Нор Норк" = 10,
  Шенгавит = 13,
  "Норк Мараш" = 11,
  Нубарашен = 12,
}

export interface Item {
  id: number;
  price: number;
  district: District;
  area: number;
}

async function sleep(ms: number) {
  return new Promise((s) => setTimeout(s, ms));
}

async function parseItems(): Promise<Array<Item>> {
  const cacheFile = "./cache.json";

  try {
    return JSON.parse((await readFile(cacheFile)).toString());
  } catch {}

  const result: Array<Item> = [];

  const currencyRates = await getCurrencyRates();

  const districts = Object.values(District).filter(
    (i): i is number => typeof i === "number"
  );

  // NOTE: iterate by districts
  for (const district of districts) {
    // NOTE: iterate by pages (maximum is 250)
    for (let page = 1; page <= 250; page++) {
      console.log(`Parsing page ${page} for district ${district}`);
      const url = `https://www.list.am/ru/category/56/${page}?type=1&n=${district}`;

      const pageRes = await fetch(url);
      if (pageRes.status === 429) {
        await sleep(1000);
        page--;
        continue;
      }
      if (pageRes.status !== 200) {
        console.log("page error", pageRes.status, await pageRes.text());
        break;
      }

      const pageHtml = parseHTML(await pageRes.text());

      // NOTE: check if current returned page = current page, if not - we reach limit of pages
      const currentPage =
        parseInt(pageHtml.querySelector(".dlf .pp .c")?.innerText!) || 1;
      if (currentPage !== page) {
        break;
      }

      // NOTE: collect all items
      const itemNodes = [
        ...Array.from(pageHtml.querySelectorAll(".gl > a")),
        ...Array.from(pageHtml.querySelectorAll(".dl > a")),
      ];

      // NOTE: parse items
      for (const itemNode of itemNodes) {
        const id = parseInt(
          itemNode.getAttribute("href")!.split("/").slice(-1)[0]
        );

        // NOTE: skip if item already collected
        if (!id || result.some((i) => i.id === id)) {
          continue;
        }

        const priceNode = itemNode.querySelector(".p");

        // NOTE: we don't need items without price
        if (!priceNode) {
          continue;
        }

        // NOTE: convert price to USD
        let price = parseFloat(
          priceNode.innerText
            .match(/\d+(\,\d+)?(\.\d+)?/)?.[0]!
            .replace(",", "")!
        );

        if (!price) {
          console.warn(`invalid price (${id})`, price);
          continue;
        }

        if (priceNode.innerText.match("֏")) {
          price /= currencyRates.amd;
        } else if (priceNode.innerText.match("₽")) {
          price /= currencyRates.rub;
        } else if (priceNode.innerText.match("€")) {
          price /= currencyRates.eur;
        }
        price = +price.toFixed(2);

        // NOTE: collect area
        const infoNode = itemNode.querySelector(".at");

        if (!infoNode) {
          continue;
        }

        const area = parseFloat(infoNode.innerText.split(",")[2]);

        if (!area) {
          console.warn(`invalid area (${id})`, area);
          continue;
        }

        result.push({ id, price, district, area });
      }
    }
  }

  if (process.env.NODE_ENV === "development") {
    await writeFile(cacheFile, JSON.stringify(result));
  }

  return result;
}

async function saveData(items: Array<Item>) {
  const filePath = "./data.json";

  const districts = Object.values(District).filter(
    (i): i is number => typeof i === "number"
  );

  let result: Record<
    string,
    Array<[string, number, number]>
  > = Object.fromEntries(districts.map((i) => [i, []]));

  try {
    result = JSON.parse((await readFile(filePath)).toString());
  } catch {}

  for (const district of districts) {
    const arr = items
      .filter((i) => i.district === district)
      .map((i) => i.price / i.area)
      .sort((a, b) => a - b);

    // NOTE: avg
    let median = (() => {
      if (arr.length === 0) return 0;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
    })();
    median = +median.toFixed(2);

    // NOTE: median
    let avg = (() => {
      if (arr.length === 0) return 0;
      return arr.reduce((p, c) => p + c, 0) / arr.length;
    })();
    avg = +avg.toFixed(2);

    const date = dayjs().format("YYYY-MM-DD");
    const item = result[district].find((i) => i[0] === date);
    if (item) {
      item[1] = avg;
      item[2] = median;
    } else {
      result[district].push([date, avg, median]);
    }
  }

  await writeFile(filePath, JSON.stringify(result));
}

(async () => {
  const items = await parseItems();
  saveData(items);
})();
