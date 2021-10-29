import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Comic } from './comic';
import { from, mergeMap } from 'rxjs';
import { Ehentai } from './ehentai';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {
    Ehentai.get('2046351/45075a2349').subscribe();
    // from(Comic.getInfoByBookId('229248'))
    //     .pipe(mergeMap((info) => Comic.getPages(info)))
    //     .subscribe();
    // from(Comic.getInfoByBookId('26038')).pipe(mergeMap(info => Comic.getPicHost(info))).subscribe(console.log)
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}

//https://e-hentai.org/g/799474/3514387231/
//https://e-hentai.org/s/d83417d7c7/799474-4
//https://ljeriar.fulvfyfixelv.hath.network/h/d83417d7c7a1ee501f56b8e7f04d7f99389a86f8-489502-1063-1500-png/keystamp=1635324600-dc3c2f57f5;fileindex=38629123;xres=org/002.png
//https://nvzvtpx.mpfuztpeofjt.hath.network:1024/h/303239dcb7b26a471952db9c75cf004ba5786689-498861-1063-1500-jpg/keystamp=1635324600-503cc2cf8a;fileindex=38776075;xres=org/a003.jpg
