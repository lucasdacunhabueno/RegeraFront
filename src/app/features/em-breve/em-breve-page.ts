import { Component, input } from '@angular/core';

@Component({
  selector: 'app-em-breve-page',
  template: `
    <h1 class="text-xl font-semibold">{{ titulo() }}</h1>
    <p class="mt-2 text-slate-600">Esta área chega nas próximas entregas do Regera.</p>
  `,
})
export class EmBrevePage {
  readonly titulo = input('');
}
