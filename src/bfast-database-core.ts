import {DatabaseFactory} from './factory/database.factory';
import {DatabaseController} from './controllers/database.controller';
import {SecurityController} from './controllers/security.controller';
import {BFastDatabaseConfigAdapter} from './bfast.config';
import {Provider} from './provider';
import {RealtimeWebservice} from './webservices/realtime.webservice';
import {AuthController} from './controllers/auth.controller';
import {AuthFactory} from './factory/auth.factory';
import {StorageController} from './controllers/storage.controller';
import {S3StorageFactory} from './factory/s3-storage.factory';
import {FilesAdapter} from './adapters/files.adapter';
import {RestController} from './controllers/rest.controller';
import {RestWebservice} from './webservices/rest.webservice';
import {StorageWebservice} from './webservices/storage.webservice';
import {AuthAdapter} from './adapters/auth.adapter';
import {GridFsStorageFactory} from './factory/grid-fs-storage.factory';
import {WebServices} from './webservices/index.webservice';

export class BfastDatabaseCore {

    /**
     * check if all required options is valid
     * @param options {BFastDatabaseConfigAdapter} - bfast database configurations
     * @param serverMode {boolean} - if true will check for port option is is set
     * @private
     */
    private static validateOptions(options: BFastDatabaseConfigAdapter, serverMode = true)
        : { valid: boolean, message: string } {
        if (!options.port && serverMode === true) {
            return {
                valid: false,
                message: 'Port option required'
            };
        }
            // else if (false /*!options.mountPath*/) {
            //     return {
            //         valid: false,
            //         message: 'Mount Path required'
            //     }
            // } else if (false /*options?.mountPath === '/storage' || options?.mountPath === '/changes'*/) {
            //     return {
            //         valid: false,
            //         message: 'Mount path name not supported'
            //     }
        // }
        else if (!options.masterKey) {
            return {
                valid: false,
                message: 'MasterKey required'
            };
        } else {
            if (!options.mongoDbUri) {
                if (!options.adapters && !options.adapters?.database) {
                    return {
                        valid: false,
                        message: 'mongoDbUri required, or supply database adapters instead'
                    };
                }
            }
            return {
                valid: true,
                message: 'no issues'
            };
        }
    }

    /**
     *
     * @param config {BFastDatabaseConfigAdapter}
     * @private
     */
    private static async _setUpDatabase(config: BFastDatabaseConfigAdapter): Promise<any> {
        const database: DatabaseController = new DatabaseController(
            (config && config.adapters && config.adapters.database)
                ? config.adapters.database(config)
                : new DatabaseFactory(config),
            new SecurityController()
        );
        await database.init();
    }

    /**
     *
     * @param config
     * @private
     */
    private _initiateServices(config: BFastDatabaseConfigAdapter): void {
        const databaseFactory = config.adapters && config.adapters.database
            ? config.adapters.database(config)
            : new DatabaseFactory(config);
        Provider.service('SecurityController', _ => new SecurityController());
        Provider.service('DatabaseController', _ => new DatabaseController(databaseFactory, Provider.get('SecurityController')));
        Provider.service('RealtimeWebservice', _ => new RealtimeWebservice(Provider.get('DatabaseController')));
        const authFactory: AuthAdapter = config.adapters && config.adapters.auth
            ? config.adapters.auth(config)
            : new AuthFactory(Provider.get('DatabaseController'), Provider.get('SecurityController'));
        Provider.service('AuthController', _ => new AuthController(authFactory, Provider.get('DatabaseController')));
        const fileFactory: FilesAdapter = config.adapters && config.adapters.s3Storage
            ? new S3StorageFactory(config)
            : new GridFsStorageFactory(config, config.mongoDbUri);
        Provider.service('StorageController', _ => new StorageController(fileFactory, Provider.get('SecurityController'), config));
        Provider.service('RestController', _ => new RestController(
            Provider.get('SecurityController'),
            Provider.get('AuthController'),
            Provider.get('StorageController'),
            config)
        );
        Provider.service('RealtimeWebService', _ => new RealtimeWebservice(Provider.get('DatabaseController')));
        Provider.service('RestWebservice', _ => new RestWebservice(Provider.get('RestController')));
        Provider.service('StorageWebservice', _ => new StorageWebservice(Provider.get('RestController')));
    }

    /**
     * initiate bfast::database engine without a built in server
     * @param options {BFastDatabaseConfigAdapter} - configurations
     */
    init(options: BFastDatabaseConfigAdapter): WebServices {
        if (BfastDatabaseCore.validateOptions(options, false).valid) {
            if (!options.adapters) {
                options.adapters = {};
            }
            this._initiateServices(options);
            BfastDatabaseCore._setUpDatabase(options).catch(_ => {
                console.error(_);
                process.exit(-1);
            });
            return new WebServices(
                Provider.get(Provider.names.REST_WEB_SERVICE),
                Provider.get(Provider.names.REALTIME_WEB_SERVICE),
                Provider.get(Provider.names.STORAGE_WEB_SERVICE)
            );
        } else {
            throw new Error(BfastDatabaseCore.validateOptions(options, false).message);
        }
    }
}
