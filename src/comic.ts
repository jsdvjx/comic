import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import * as Path from 'path';
import {
  catchError,
  concatMap,
  filter,
  finalize,
  from,
  map,
  of,
  range,
  switchMap,
  tap,
  toArray,
} from 'rxjs';
import {
  createWriteStream,
  mkdir,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { Stream } from 'stream';
import { fileExistsSync } from 'tsconfig-paths/lib/filesystem';
import * as AdmZip from 'adm-zip';
import { Logger } from '@nestjs/common';

export type ComicInfo = {
  cover: string;
  page_id: string;
  author: string;
  count: number;
  created_at: string;
  book_id: string;
  title: string;
  tags: string[];
};

export class Comic {
  private static base = 'https://zha.qqhentai.com/';
  static get = (id: string) => {};

  private static bookUrl = (id: string) => {
    return `${Comic.base}g/${id}`;
  };
  private static getPicHost = (info: ComicInfo) => {
    const path = `${Comic.bookUrl(info.book_id)}/list/1`;
    return from(axios.get(path, { responseType: 'text' })).pipe(
      map((response) => cheerio.load(response.data as string)),
      map(($) => $('#image-container img').attr('src')),
      map((url) => ({
        cdn: url.replace(/\d+\.[a-zA-Z]+$/, ''),
        ext: url.split('.').pop(),
      })),
    );
  };

  static getPages = (info: ComicInfo) => {
    const cdnPath = info.cover.replace(info.cover.split('/').pop(), '');
    const book = `data/${info.book_id}`;
    const zipPath = `data/${info.book_id}/${info.title}.zip`;
    mkdirSync(book, { recursive: true });
    writeFileSync(`${book}/info.json`, JSON.stringify(info));
    return this.getPicHost(info).pipe(
      switchMap(({ cdn, ext }) => {
        return range(1, info.count).pipe(
          map((page) => [`${book}/${page}.${ext}`, page] as [string, number]),
          filter(([path]) => !fileExistsSync(path)),
          concatMap(([path, page]) => {
            Logger.debug(
              `${Math.ceil((page / info.count) * 100)}%`,
              Comic.name,
            );
            console.log(`${cdn}${page}.${ext}`);
            return from(
              axios
                .get(`${cdn}${page}.${ext}`, {
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
            ).pipe(catchError(() => of(null)));
          }),
          toArray(),
          tap(() => {
            const zip = new AdmZip();
            const list = readdirSync(book)
              .filter((i) => i.endsWith(ext))
              .map((i) => `${book}/${i}`);
            list.forEach((path) => {
              zip.addLocalFile(path);
            });
            zip.writeZip(zipPath);
            list.forEach((path) => unlinkSync(path));
          }),
          finalize(() => Logger.debug(`${info.title} done!`, Comic.name)),
        );
      }),
    );
  };

  static getInfoByBookId = (id: string) => {
    return axios
      .get(Comic.bookUrl(id))
      .then((response) => cheerio.load(response.data as string))
      .then(($) => {
        const cover = cheerio
          .load($('#cover noscript').html())('img')
          .attr('src');
        return {
          book_id: id,
          cover,
          page_id: cover.split('/').reverse()[1],
          title: $('h1').text(),
          created_at: $('#info-block time').html(),
          tags: cheerio
            .load($('.tag-container').get(0))('a.tag')
            .toArray()
            .map((i) => cheerio.load(i).text().split(' ').shift().trim()),
          author: cheerio
            .load($('.tag-container .tags .tag').get(0))
            .text()
            .replace(/\(\d+\)/, '')
            .trim(),
          count: parseInt(
            cheerio
              .load($('#info-block #info>div').get(0))
              .html()
              .match(/\d+/)[0],
          ),
        } as ComicInfo;
      });
  };
}
