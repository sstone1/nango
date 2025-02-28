import type { NextFunction, Request, Response } from 'express';
import { configService, Config as ProviderConfig } from '@nangohq/shared';
import analytics from '../utils/analytics.js';
import { getAccount, getUserAndAccountFromSession, parseConnectionConfigParamsFromTemplate } from '../utils/utils.js';
import errorManager from '../utils/error.manager.js';
import connectionService from '../services/connection.service.js';
import { NangoError } from '../utils/error.js';

interface Integration {
    uniqueKey: string;
    provider: string;
    connectionCount: number;
    creationDate: Date | undefined;
    connectionConfigParams?: string[];
}

class ConfigController {
    /**
     * Webapp
     */

    async listProviderConfigsWeb(req: Request, res: Response, next: NextFunction) {
        try {
            const account = (await getUserAndAccountFromSession(req)).account;

            const configs = await configService.listProviderConfigs(account.id);

            const connections = await connectionService.listConnections(account.id);

            const integrations = configs.map((config: ProviderConfig) => {
                const template = configService.getTemplates()[config.provider];
                const integration: Integration = {
                    uniqueKey: config.unique_key,
                    provider: config.provider,
                    connectionCount: connections.filter((connection) => connection.provider === config.unique_key).length,
                    creationDate: config.created_at
                };
                if (template) {
                    integration['connectionConfigParams'] = parseConnectionConfigParamsFromTemplate(template!);
                }
                return integration;
            });

            res.status(200).send({
                integrations: integrations.sort(function (a: Integration, b: Integration) {
                    return b.creationDate!.getTime() - a.creationDate!.getTime();
                })
            });
        } catch (err) {
            console.log(err);
            next(err);
        }
    }

    async createProviderConfigWeb(req: Request, res: Response, next: NextFunction) {
        try {
            let account = (await getUserAndAccountFromSession(req)).account;

            if (req.body == null) {
                errorManager.errRes(res, 'missing_body');
                return;
            }

            if (req.body['provider_config_key'] == null) {
                errorManager.errRes(res, 'missing_provider_config');
                return;
            }

            if (req.body['provider'] == null) {
                errorManager.errRes(res, 'missing_provider_template');
                return;
            }

            let provider = req.body['provider'];

            if (!configService.checkProviderTemplateExists(provider)) {
                errorManager.errRes(res, 'unknown_provider_template');
                return;
            }

            if (req.body['client_id'] == null) {
                errorManager.errRes(res, 'missing_client_id');
                return;
            }

            if (req.body['client_secret'] == null) {
                errorManager.errRes(res, 'missing_client_secret');
                return;
            }

            let uniqueConfigKey = req.body['provider_config_key'];

            if ((await configService.getProviderConfig(uniqueConfigKey, account.id)) != null) {
                errorManager.errRes(res, 'duplicate_provider_config');
                return;
            }

            let config: ProviderConfig = {
                unique_key: uniqueConfigKey,
                provider: provider,
                oauth_client_id: req.body['client_id'],
                oauth_client_secret: req.body['client_secret'],
                oauth_scopes: req.body['scopes']
                    .replace(/ /g, ',')
                    .split(',')
                    .filter((w: string) => w)
                    .join(','), // Make coma-separated if needed
                account_id: account.id
            };

            const result = await configService.createProviderConfig(config);

            if (Array.isArray(result) && result.length === 1 && result[0] != null && 'id' in result[0]) {
                analytics.track('server:config_created', account.id, { provider: config.provider });
                res.status(200).send();
            } else {
                throw new NangoError('provider_config_creation_failure');
            }
        } catch (err) {
            next(err);
        }
    }

    async editProviderConfigWeb(req: Request, res: Response, next: NextFunction) {
        try {
            let account = (await getUserAndAccountFromSession(req)).account;

            if (req.body == null) {
                errorManager.errRes(res, 'missing_body');
                return;
            }

            if (req.body['provider_config_key'] == null) {
                errorManager.errRes(res, 'missing_provider_config');
                return;
            }

            if (req.body['provider'] == null) {
                errorManager.errRes(res, 'missing_provider_template');
                return;
            }
            if (req.body['client_id'] == null) {
                errorManager.errRes(res, 'missing_client_id');
                return;
            }
            if (req.body['client_secret'] == null) {
                errorManager.errRes(res, 'missing_client_secret');
                return;
            }

            let newConfig: ProviderConfig = {
                unique_key: req.body['provider_config_key'],
                provider: req.body['provider'],
                oauth_client_id: req.body['client_id'],
                oauth_client_secret: req.body['client_secret'],
                oauth_scopes: req.body['scopes'],
                account_id: account.id
            };

            let oldConfig = await configService.getProviderConfig(newConfig.unique_key, account.id);

            if (oldConfig == null) {
                errorManager.errRes(res, 'unknown_provider_config');
                return;
            }

            await configService.editProviderConfig(newConfig);
            res.status(200).send();
        } catch (err) {
            next(err);
        }
    }

    async deleteProviderConfigWeb(req: Request, res: Response, next: NextFunction) {
        try {
            let account = (await getUserAndAccountFromSession(req)).account;
            let providerConfigKey = req.params['providerConfigKey'] as string;

            if (providerConfigKey == null) {
                errorManager.errRes(res, 'missing_provider_config');
                return;
            }

            await configService.deleteProviderConfig(providerConfigKey, account.id);

            res.status(200).send();
        } catch (err) {
            next(err);
        }
    }

    async getProviderConfigWeb(req: Request, res: Response, next: NextFunction) {
        try {
            let account = (await getUserAndAccountFromSession(req)).account;
            let providerConfigKey = req.params['providerConfigKey'] as string;

            if (providerConfigKey == null) {
                errorManager.errRes(res, 'missing_provider_config');
                return;
            }

            let config = await configService.getProviderConfig(providerConfigKey, account.id);

            if (config == null) {
                errorManager.errRes(res, 'unknown_provider_config');
                return;
            }

            res.status(200).send({
                integration: {
                    uniqueKey: config.unique_key,
                    provider: config.provider,
                    clientId: config.oauth_client_id,
                    clientSecret: config.oauth_client_secret,
                    scopes: config.oauth_scopes
                }
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * CLI
     */

    async listProviderConfigs(_: Request, res: Response, next: NextFunction) {
        try {
            let accountId = getAccount(res);
            let configs = await configService.listProviderConfigs(accountId);
            let results = configs.map((c: ProviderConfig) => ({ unique_key: c.unique_key, provider: c.provider }));
            res.status(200).send({ configs: results });
        } catch (err) {
            next(err);
        }
    }

    async getProviderConfig(req: Request, res: Response, next: NextFunction) {
        try {
            let accountId = getAccount(res);
            let providerConfigKey = req.params['providerConfigKey'] as string;

            if (providerConfigKey == null) {
                errorManager.errRes(res, 'missing_provider_config');
                return;
            }

            let config = await configService.getProviderConfig(providerConfigKey, accountId);

            if (config == null) {
                errorManager.errRes(res, 'unknown_provider_config');
                return;
            }

            res.status(200).send({ config: { unique_key: config.unique_key, provider: config.provider } });
        } catch (err) {
            next(err);
        }
    }

    async createProviderConfig(req: Request, res: Response, next: NextFunction) {
        try {
            let accountId = getAccount(res);
            if (req.body == null) {
                errorManager.errRes(res, 'missing_body');
                return;
            }

            if (req.body['provider_config_key'] == null) {
                errorManager.errRes(res, 'missing_provider_config');
                return;
            }

            if (req.body['provider'] == null) {
                errorManager.errRes(res, 'missing_provider_template');
                return;
            }

            let provider = req.body['provider'];

            if (!configService.checkProviderTemplateExists(provider)) {
                errorManager.errRes(res, 'unknown_provider_template');
                return;
            }

            if (req.body['oauth_client_id'] == null) {
                errorManager.errRes(res, 'missing_client_id');
                return;
            }

            if (req.body['oauth_client_secret'] == null) {
                errorManager.errRes(res, 'missing_client_secret');
                return;
            }

            let uniqueConfigKey = req.body['provider_config_key'];

            if ((await configService.getProviderConfig(uniqueConfigKey, accountId)) != null) {
                errorManager.errRes(res, 'duplicate_provider_config');
                return;
            }

            let config: ProviderConfig = {
                unique_key: uniqueConfigKey,
                provider: provider,
                oauth_client_id: req.body['oauth_client_id'],
                oauth_client_secret: req.body['oauth_client_secret'],
                oauth_scopes: req.body['oauth_scopes']
                    .replace(/ /g, ',')
                    .split(',')
                    .filter((w: string) => w)
                    .join(','), // Make coma-separated if needed
                account_id: accountId
            };

            let result = await configService.createProviderConfig(config);

            if (Array.isArray(result) && result.length === 1 && result[0] != null && 'id' in result[0]) {
                analytics.track('server:config_created', accountId, { provider: config.provider });
                res.status(200).send();
            } else {
                throw new NangoError('provider_config_creation_failure');
            }
        } catch (err) {
            next(err);
        }
    }

    async editProviderConfig(req: Request, res: Response, next: NextFunction) {
        try {
            let accountId = getAccount(res);
            if (req.body == null) {
                errorManager.errRes(res, 'missing_body');
                return;
            }

            if (req.body['provider_config_key'] == null) {
                errorManager.errRes(res, 'missing_provider_config');
                return;
            }

            if (req.body['provider'] == null) {
                errorManager.errRes(res, 'missing_provider_template');
                return;
            }
            if (req.body['oauth_client_id'] == null) {
                errorManager.errRes(res, 'missing_client_id');
                return;
            }
            if (req.body['oauth_client_secret'] == null) {
                errorManager.errRes(res, 'missing_client_secret');
                return;
            }

            let newConfig: ProviderConfig = {
                unique_key: req.body['provider_config_key'],
                provider: req.body['provider'],
                oauth_client_id: req.body['oauth_client_id'],
                oauth_client_secret: req.body['oauth_client_secret'],
                oauth_scopes: req.body['oauth_scopes'],
                account_id: accountId
            };

            let oldConfig = await configService.getProviderConfig(newConfig.unique_key, accountId);

            if (oldConfig == null) {
                errorManager.errRes(res, 'unknown_provider_config');
                return;
            }

            await configService.editProviderConfig(newConfig);
            res.status(200).send();
        } catch (err) {
            next(err);
        }
    }

    async deleteProviderConfig(req: Request, res: Response, next: NextFunction) {
        try {
            let accountId = getAccount(res);
            let providerConfigKey = req.params['providerConfigKey'] as string;

            if (providerConfigKey == null) {
                errorManager.errRes(res, 'missing_provider_config');
                return;
            }

            await configService.deleteProviderConfig(providerConfigKey, accountId);

            res.status(200).send();
        } catch (err) {
            next(err);
        }
    }
}

export default new ConfigController();
