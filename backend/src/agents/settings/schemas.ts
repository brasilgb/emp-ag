import { z } from 'zod';

import { isSettingKey } from './catalog.js';

// Agentes v1.7 - validacao de entrada das rotas de settings. Mesmo
// padrao do resto do modulo Agentes: nunca aceita chave desconhecida
// (isSettingKey), nunca confia em tipo vindo do cliente sem checagem
// (o range real e checado depois via validateSettingValue, que conhece o
// catalogo por chave - aqui so garantimos "e uma chave conhecida" e "e
// um numero", a mensagem detalhada de faixa fica a cargo da rota).
export const settingKeyParamSchema = z.object({
  key: z.string().refine(isSettingKey, { message: 'Chave de configuracao desconhecida.' }),
});

export const jobIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const jobSettingKeyParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  key: z.string().refine(isSettingKey, { message: 'Chave de configuracao desconhecida.' }),
});

export const setSettingBodySchema = z.object({ value: z.number() }).strict();
