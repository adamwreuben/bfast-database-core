import {BFast} from 'bfastnode';
import {RestController} from '../controllers/rest.controller';
import {FunctionsModel} from '../model/functions.model';


let restController: RestController;

export class StorageWebservice {
    constructor(rest: RestController) {
        restController = rest;
    }

    private static handleGetFile(): any[] {
        return [
            (request, _, next) => {
                request.body.applicationId = request.params.appId;
                request.body.ruleId = 'files.read';
                next();
            },
            restController.verifyApplicationId,
            restController.verifyToken,
            restController.filePolicy,
            restController.getFile
        ];
    }

    private static handleUploadFile(): any[] {
        return [
            (request, response, next) => {
                request.body.applicationId = request.params.appId;
                request.body.ruleId = 'files.save';
                next();
            },
            restController.verifyApplicationId,
            restController.verifyToken,
            restController.filePolicy,
            restController.multipartForm
        ];
    }

    private static handleGetThumbnail(): any[] {
        return [
            (request, _, next) => {
                request.body.applicationId = request.params.appId;
                request.body.ruleId = 'files.read';
                next();
            },
            restController.verifyApplicationId,
            restController.verifyToken,
            restController.filePolicy,
            restController.getThumbnail
        ];
    }

    private static handleListFiles(): any[] {
        return [
            (request, _, next) => {
                request.body.applicationId = request.params.appId;
                request.body.ruleId = 'files.list';
                next();
            },
            restController.verifyApplicationId,
            restController.verifyToken,
            restController.filePolicy,
            restController.getAllFiles
        ];
    }

    getUploadFileV2(): FunctionsModel {
        return BFast.functions().onGetHttpRequest('/storage/:appId',
            (request, response: any) => {
                // show a file upload form
                response.writeHead(200, {'content-type': 'text/html'});
                response.end(`
                    <h2>With Node.js <code>"http"</code> module</h2>
                    <form action="/v2/storage/${request.params.appId}" enctype="multipart/form-data" method="post">
                      <div>Text field title: <input type="text" name="file" /></div>
                      <div>File: <input type="file" name="multipleFiles" multiple="multiple" /></div>
                      <input type="submit" value="Upload" />
                    </form>
                 `);
            });
    }

    getFileStorageV1(): FunctionsModel {
        return BFast.functions().onGetHttpRequest('/files/:appId/:filename', StorageWebservice.handleGetFile());
    }

    getFileFromStorage(): FunctionsModel {
        return BFast.functions().onGetHttpRequest('/storage/:appId/file/:filename', StorageWebservice.handleGetFile());
    }

    getFileFromStorageV2(): FunctionsModel {
        return BFast.functions().onGetHttpRequest('/v2/storage/:appId/file/:filename', StorageWebservice.handleGetFile());
    }

    geThumbnailFromStorage(): FunctionsModel {
        return BFast.functions().onGetHttpRequest('/storage/:appId/file/:filename/thumbnail', StorageWebservice.handleGetThumbnail());
    }

    geThumbnailFromStorageV2(): FunctionsModel {
        return BFast.functions().onGetHttpRequest('/v2/storage/:appId/file/:filename/thumbnail', StorageWebservice.handleGetThumbnail());
    }

    uploadMultiPartFile(): FunctionsModel {
        return BFast.functions().onPostHttpRequest('/storage/:appId', StorageWebservice.handleUploadFile());
    }

    uploadMultiPartFileV2(): FunctionsModel {
        return BFast.functions().onPostHttpRequest('/v2/storage/:appId', StorageWebservice.handleUploadFile());
    }

    getFilesFromStorage(): FunctionsModel {
        return BFast.functions().onGetHttpRequest('/storage/:appId/list', StorageWebservice.handleListFiles());
    }

    getFilesFromStorageV2(): FunctionsModel {
        return BFast.functions().onGetHttpRequest('/v2/storage/:appId/list', StorageWebservice.handleListFiles());
    }
}
