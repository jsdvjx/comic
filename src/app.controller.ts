import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Comic } from './comic';
import { from, mergeMap } from 'rxjs';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {
    from(Comic.getInfoByBookId('260238'))
      .pipe(mergeMap((info) => Comic.getPages(info)))
      .subscribe();
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
