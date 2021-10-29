import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import {
  buffer,
  bufferCount,
  catchError,
  concat,
  concatMap,
  delay,
  filter,
  finalize,
  flatMap,
  from,
  map,
  merge,
  mergeMap,
  of,
  range,
  retry,
  take,
  tap,
  toArray,
  zip,
} from 'rxjs';
import * as Agent from 'https-proxy-agent';
import { attr } from 'cheerio/lib/api/attributes';
import { decode } from 'html-entities';
import { flatten, Logger } from '@nestjs/common';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { Stream } from 'stream';
import * as AdmZip from 'adm-zip';
import * as https from 'https';

const titleResolve = (title: string) =>
  title.toLowerCase().trim().replace(/:$/, '').replace(' ', '_');
const valueResolve = (value: string) =>
  decode(value).replace(/<.+>/, '').toLowerCase().trim();
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore

export type ComicInfo = {
  id: string;
  tags: { category: string; tags: string[] }[];
  posted: string;
  language: string;
  length: string;
  favorited: string;
  images: string[];
  title: string;
};

export class Ehentai {
  private static baseUrl = 'https://e-hentai.org/g/';

  private static getBookUrl = (id: string) => {
    const { idDecode, idEncode } = Ehentai;
    return `${Ehentai.baseUrl}${idDecode(idEncode(id))}`;
  };
  private static idEncode = (id: string) => {
    return id.replace(/\/$/, '').replace(/\//g, '_').trim();
  };
  private static idDecode = (encode: string) => {
    return encode.replace(/_/g, '/').trim() + '/';
  };
  static get = (id: string) => {
    const path = Ehentai.savePath(Ehentai.idEncode(id));
    let _info: ComicInfo;
    return this.getInfo(id).pipe(
      tap((info) => {
        _info = info;
      }),
      mergeMap(Ehentai.getImageUrls),
      mergeMap((urls) => {
        return Ehentai.downloadImages(urls, path);
      }),
      finalize(() => {
        Ehentai.zip(_info);
        Logger.debug(`${_info.title} done!`, Ehentai.name);
      }),
    );
  };
  private static zip = (info: ComicInfo) => {
    const path = Ehentai.savePath(info.id);
    const zip = new AdmZip();
    const list = readdirSync(path)
      .filter((i) => i.split('.').pop() !== 'json')
      .map((i) => `${path}${i}`);
    if (list.length === parseInt(info.length.replace(' pages', ''))) {
      list.forEach((path) => {
        zip.addLocalFile(path);
      });
      zip.writeZip(`${path}${info.title}.zip`);
      list.forEach((path) => unlinkSync(path));
      unlinkSync(`${path}imageUrls.json`);
    } else {
      Logger.error(`error!! ${list.length}!=${info.length}`, Ehentai.name);
    }
  };
  static getInfo = (id: string) => {
    const {
      getBookUrl,
      getHtml,
      resolveInfo,
      idEncode,
      saveInfo,
      getInfoLocal,
    } = Ehentai;
    const _info = getInfoLocal(id);
    return _info
      ? of(_info)
      : getHtml(getBookUrl(id)).pipe(
          mergeMap(resolveInfo),
          map((info) => ({ ...info, id: idEncode(id) })),
          tap(saveInfo),
        );
  };
  private static downloadImages = (urls: string[], basePath: string) => {
    return from(
      urls
        .map(
          (url, idx) =>
            [url, `${basePath}${idx + 1}.${url.split('.').pop()}`, idx + 1] as [
              string,
              string,
              number,
            ],
        )
        .filter(([_, path]) => {
          return !existsSync(path);
        }),
    ).pipe(
      bufferCount(5),
      concatMap((list) => {
        return from(list).pipe(
          mergeMap(([url, path, index]) => {
            Logger.debug(`begin download ${index}`, Ehentai.name);
            return this.downloadImage(url, path);
          }),
          toArray(),
        );
      }),
      toArray(),
      mergeMap((i) => i),
    );
  };
  private static downloadImage = (url: string, path: string) => {
    if (existsSync(path)) {
      return of(path);
    }
    return from(
      axios
        .get(url, {
          responseType: 'stream',
          timeout: 5000,
        })
        .then((response: AxiosResponse<Stream>) => {
          const writer = createWriteStream(path);
          response.data.pipe(writer);
          return new Promise<string>((resolve, reject) => {
            writer.on('finish', () => resolve(path));
            writer.on('error', reject);
          });
        }),
    ).pipe(
      retry(3),
      catchError((e) => {
        Logger.error(`${e.message},${path},${url}`, Ehentai.name);
        return of(null);
      }),
    );
  };
  private static getInfoLocal = (id: string) => {
    const { savePath, idEncode } = this;
    const path = savePath(idEncode(id) + '/info.json');
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path).toString()) as ComicInfo;
    }
    return null;
  };

  private static resolveInfoBase = ($: cheerio.CheerioAPI) => {
    const titles = ['language', 'length', 'posted', 'favorited'];
    return from(
      $('.gm #gdd')
        .find('tr')
        .toArray()
        .map((i) => cheerio.load(i)),
    ).pipe(
      map((table) => {
        return [
          titleResolve(table('.gdt1').html()),
          valueResolve(table('.gdt2').html()),
        ];
      }),
      filter(([title]) => titles.includes(title)),
      toArray(),
      map(
        (list) =>
          Object.fromEntries(list) as {
            posted: string;
            language: string;
            length: string;
            favorited: string;
          },
      ),
    );
  };
  private static resolveTags = ($: cheerio.CheerioAPI) => {
    return from(
      $('.gm #taglist tr')
        .toArray()
        .map((i) => cheerio.load(i)),
    ).pipe(
      map((node) => {
        return [
          titleResolve(node('.tc').html()),
          node('.gt a')
            .toArray()
            .map((i) => cheerio.load(i).html().replace(/<.+?>/g, '')),
        ];
      }),
      map(
        ([category, tags]) =>
          ({ category, tags } as { category: string; tags: string[] }),
      ),
      toArray(),
    );
  };
  private static getImageUrlsLocal = (info: ComicInfo) => {
    const { savePath } = this;
    const path = `${savePath(info.id)}imageUrls.json`;
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path).toString()) as string[];
    }
    return null;
  };
  private static getImageUrls = (info: ComicInfo) => {
    const { getImageUrlsLocal, getHtmlResponse, savePath } = this;
    const _urls = getImageUrlsLocal(info);
    return _urls
      ? of(_urls)
      : from(info.images).pipe(
          bufferCount(5),
          delay(1000),
          concatMap((urls) => {
            return from(urls).pipe(
              mergeMap((url) => getHtmlResponse(url)),
              map(
                (i) =>
                  [
                    parseInt(i.config.url.split('-').pop()),
                    cheerio
                      .load(i.data as string)('img#img')
                      .attr('src'),
                  ] as [number, string],
              ),
              toArray(),
            );
          }),
          mergeMap((i) => i),
          toArray(),
          map((list) => list.sort(([a], [b]) => a - b)),
          map((list) => list.map(([, img]) => img)),
          tap((list) => {
            const path = `${savePath(info.id)}imageUrls.json`;
            writeFileSync(path, JSON.stringify(list));
          }),
        );
  };

  private static getImagePages = ($: cheerio.CheerioAPI) => {
    const { getHtml } = this;
    return merge(
      from(
        Array.from(
          new Set(
            $('.ptt td')
              .toArray()
              .map((i) => cheerio.load(i)('a').attr('href'))
              .filter((i) => !!i && i.indexOf('?') > 0),
          ),
        ),
      ).pipe(
        concatMap((url) =>
          getHtml(url).pipe(map((html) => cheerio.load(html))),
        ),
      ),
      of($),
    ).pipe(
      map((n) => {
        return n('.gdtm')
          .toArray()
          .map((j) => cheerio.load(j)('a').attr('href'));
      }),
      mergeMap((i) => i),
      toArray(),
      map((i) =>
        i.sort(
          (a, b) =>
            parseInt(a.replace(/.+-/, '')) - parseInt(b.replace(/.+-/, '')),
        ),
      ),
    );
  };
  private static resolveInfo = (html: string) => {
    const { resolveInfoBase, resolveTags, getImagePages } = this;
    const node = cheerio.load(html);
    const title = node('h1#gj').html();
    return zip(resolveTags(node), resolveInfoBase(node)).pipe(
      map(([tags, info]) => ({ ...info, tags })),
      mergeMap((info) => {
        return getImagePages(node).pipe(
          map((images) => ({ ...info, images, title } as ComicInfo)),
        );
      }),
    );
  };

  private static getHtml = (url: string) => {
    return from(
      axios
        .get(url, { headers: { cookie: 'nw=1' } })
        .then((response: AxiosResponse<string>) => response.data),
    );
  };
  private static getHtmlResponse = (url: string) => {
    return from(axios.get(url, { httpsAgent: agent }));
  };
  private static saveInfo = (info: ComicInfo) => {
    const { savePath } = this;
    const path = savePath(info.id);
    mkdirSync(path, { recursive: true });
    writeFileSync(`${path}info.json`, JSON.stringify(info));
  };
  private static savePath = (id: string) => {
    return `data/${id}/`;
  };
}
