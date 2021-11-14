import {BasicAttributesModel} from '../models/basic-attributes.model';
import {ContextBlock} from '../models/rules.model';
import {DeleteModel} from '../models/delete-model';
import {QueryModel} from '../models/query-model';
import {generateUUID} from './security.controller';
import {ChangesModel} from '../models/changes.model';
import {ChangesDocModel} from "../models/changes-doc.model";
import {AppEventsFactory} from "../factories/app-events.factory";
import {ConstUtil} from "../utils/const.util";
import {BFastOptions} from "../bfast-database.option";
import {DatabaseWriteOptions} from "../models/database-write-options";
import {DatabaseUpdateOptions} from "../models/database-update-options";
import {DatabaseBasicOptions} from "../models/database-basic-options";
import {DatabaseChangesOptions} from "../models/database-changes-options";
import {
    _aggregate,
    _createData,
    _getData,
    _getManyData,
    _init,
    _purgeData,
    _updateData
} from "../factories/database-factory-resolver";
import {UpdateModel} from "../models/update-model";
import moment from 'moment';
import {execFile} from 'child_process';

export async function handleDomainValidation(domain: string): Promise<any> {
    if (!validDomain(domain)) {
        throw {
            message: `${domain} is not a valid domain name`
        };
    }
    return true;
}

export async function init(options: BFastOptions): Promise<any> {
    return _init(options);
}

export async function checkPolicyInDomain(domain: string, options: DatabaseWriteOptions) {
    if (options && options.bypassDomainVerification === false) {
        await handleDomainValidation(domain);
    }
}

export async function writeOne<T extends BasicAttributesModel>(
    domain: string,
    data: T,
    cids: boolean,
    context: ContextBlock,
    writeOptions: DatabaseWriteOptions = {bypassDomainVerification: false},
    options: BFastOptions
): Promise<T> {
    await checkPolicyInDomain(domain, writeOptions);
    const returnFields = getReturnFields(data);
    const sanitizedDataWithCreateMetadata = addCreateMetadata(data, context);
    const sanitizedData: any = sanitize4Db(sanitizedDataWithCreateMetadata);
    const savedData: any = await _createData(domain, sanitizedData, options);
    const cleanDoc: any = sanitize4User(savedData, returnFields) as T;
    publishChanges(domain, {
        _id: cleanDoc?.id,
        fullDocument: cleanDoc,
        documentKey: cleanDoc?.id,
        operationType: "create"
    }, options);
    return cleanDoc;
}

export async function writeMany<T extends BasicAttributesModel>(
    domain: string,
    data: T[],
    cids: boolean,
    context: ContextBlock,
    writeOptions: DatabaseWriteOptions = {bypassDomainVerification: false},
    options: BFastOptions
): Promise<any[]> {
    const dP = data.map(d => writeOne(domain, d, cids, context, writeOptions, options));
    return Promise.all(dP);
}

export async function updateOne(
    domain: string,
    updateModel: UpdateModel,
    context: ContextBlock,
    updateOptions: DatabaseUpdateOptions = {bypassDomainVerification: false},
    options: BFastOptions
): Promise<any> {
    await checkPolicyInDomain(domain, updateOptions);
    if (updateModel.upsert === true) {
        if (!updateModel.update.hasOwnProperty('$set')) {
            updateModel.update.$set = {_id: updateModel.id ? updateModel.id : generateUUID()}
        }
    }
    const returnFields = getReturnFields(updateModel as any);
    updateModel = altUpdateModel(updateModel);
    // console.log(updateModel);
    const updatedDoc = await _updateData(domain, updateModel, options);
    const cleanDoc = sanitize4User(updatedDoc, returnFields);
    publishChanges(domain, {
        _id: updatedDoc?._id,
        fullDocument: updatedDoc,
        operationType: "update"
    }, options);
    return cleanDoc;
}

export async function updateMany(
    domain: string,
    updateModel: UpdateModel,
    context: ContextBlock,
    updateOptions: DatabaseUpdateOptions = {bypassDomainVerification: false},
    options: BFastOptions
): Promise<any> {
    await checkPolicyInDomain(domain, updateOptions);
    let oldDocs: any[] = await findByFilter(domain, updateModel, context, updateOptions, options);
    if (!Array.isArray(oldDocs)) {
        return [];
    }
    if (oldDocs.length === 0 && updateModel.upsert === true) {
        oldDocs = [{id: generateUUID()}];
    }
    oldDocs = oldDocs.map(old => old.id);
    oldDocs = Array.from(oldDocs.reduce((a, b) => a.add(b), new Set()));
    const _p = oldDocs.map(_id => {
        const uM = JSON.parse(JSON.stringify(updateModel));
        uM.id = _id;
        return updateOne(domain, uM, context, updateOptions, options);
    });
    const _a = await Promise.all(_p);
    return _a.filter(_a1 => _a1 !== null);
}

function altUpdateModel(updateModel: UpdateModel): UpdateModel {
    updateModel.update = sanitizeWithOperator4Db(updateModel?.update as any);
    updateModel.filter = sanitizeWithOperator4Db(updateModel?.filter as any);
    updateModel.update = addUpdateMetadata(updateModel?.update as any);
    return updateModel;
}

export async function remove(
    domain: string, deleteModel: DeleteModel<any>, context: ContextBlock,
    basicOptions: DatabaseBasicOptions = {bypassDomainVerification: false}, options: BFastOptions
): Promise<any> {
    await checkPolicyInDomain(domain, basicOptions);
    deleteModel.filter = sanitizeWithOperator4Db(deleteModel?.filter as any);
    let result = [];
    if (deleteModel && deleteModel.id) {
        await _purgeData(domain, deleteModel.id, options);
        result.push({id: deleteModel.id});
    }
    if (deleteModel && deleteModel.filter) {
        let all = await findByFilter(domain, deleteModel, context, basicOptions, options);
        const _p = all.map(async a => {
            await _purgeData(domain, a.id, options);
            return {id: a.id};
        });
        const _pa = await Promise.all(_p);
        result.push(..._pa);
    }
    return result.map(t => {
        const cleanDoc = sanitize4User(t, deleteModel.return);
        publishChanges(domain, {
            _id: t?._id,
            fullDocument: t,
            documentKey: t?._id,
            operationType: "delete"
        }, options);
        return cleanDoc;
    });
}

export async function bulk<S>(
    operations: (session: S) => Promise<any>
): Promise<any> {
    return await operations(null);
}

export async function changes(
    domain: string,
    projectId: string,
    pipeline: any[], listener: (doc: ChangesDocModel) => void,
    options: DatabaseChangesOptions = {bypassDomainVerification: false, resumeToken: undefined}
): Promise<{ close: () => void }> {
    if (options && options.bypassDomainVerification === false) {
        await handleDomainValidation(domain);
    }
    const _listener = (doc: ChangesModel) => {
        switch (doc.operationType) {
            case 'create':
                listener({
                    name: 'create',
                    snapshot: sanitize4User(doc.fullDocument, [])
                });
                return;
            case 'update':
                listener({
                    name: 'update',
                    snapshot: sanitize4User(doc.fullDocument, [])
                });
                return;
            case 'delete':
                listener({
                    name: 'delete',
                    snapshot: sanitize4User(doc.fullDocument, [])
                });
                return;
        }
    }
    const appEventInst = AppEventsFactory.getInstance();
    const eventName = appEventInst.eventName(projectId, domain);
    appEventInst.sub(eventName, _listener);
    return {
        close: () => {
            appEventInst.unSub(eventName, _listener);
        }
    }
}

export async function findById(
    domain: string, queryModel: QueryModel<any>,
    writeOptions: DatabaseWriteOptions = {bypassDomainVerification: false}, options: BFastOptions
): Promise<any> {
    const returnFields = getReturnFields(queryModel as any);
    const returnFields4Db = getReturnFields4Db(queryModel as any);
    await checkPolicyInDomain(domain, writeOptions);
    const id = queryModel.id;
    queryModel.return = returnFields4Db;
    const data = await _getData(domain, id, options);
    return sanitize4User(data, returnFields);
}

export async function findByFilter(
    domain: string, queryModel: QueryModel<any>, context: ContextBlock,
    writeOptions: DatabaseWriteOptions = {bypassDomainVerification: false}, options: BFastOptions
): Promise<any> {
    const returnFields = getReturnFields(queryModel as any);
    const returnFields4Db = getReturnFields4Db(queryModel as any);
    await checkPolicyInDomain(domain, writeOptions);
    queryModel = sanitizeWithOperator4Db(queryModel as any);
    queryModel.filter = sanitizeWithOperator4Db(queryModel?.filter ? queryModel.filter : {});
    queryModel.return = returnFields4Db;
    let result = await _getManyData(domain, queryModel, options);
    if (result && Array.isArray(result)) {
        return result.map(v => sanitize4User(v, returnFields));
    }
    return result;
}

export function addUpdateMetadata(data: any): any {
    if (data && typeof data !== 'boolean') {
        if (data.$set) {
            let userDate = data.$set.updatedAt;
            if (moment(userDate).isValid()) {
                userDate = moment(userDate).toISOString();
            }
            data.$set.updatedAt = userDate ? userDate : new Date();
            data.$set = sanitize4Db(data.$set);
        } else {
            data.$set = {};
            data.$set.updatedAt = new Date();
        }
        delete data.$set._id;
        return data;
    }
    return data;
}

export function validDomain(domain: string): boolean {
    return (domain !== '_User' && domain !== '_Token' && domain !== '_Policy');
}

export function addCreateMetadata(data: any, context: ContextBlock) {
    let userUpdateDate = data.updatedAt;
    if (moment(userUpdateDate).isValid()) {
        userUpdateDate = moment(userUpdateDate).toISOString();
    }
    let userCreateDate = data.createdAt;
    if (moment(userCreateDate).isValid()) {
        userCreateDate = moment(userCreateDate).toISOString();
    }
    if (context) {
        data.createdBy = context.uid ? context.uid : null;
    }
    data.createdAt = userCreateDate ? userCreateDate : new Date();
    data.updatedAt = userUpdateDate ? userUpdateDate : new Date();
    if (data._id) {
        return data;
    }
    data._id = data && data.id ? data.id : generateUUID();
    delete data.id;
    return data;
}

export function getReturnFields(data: any): any {
    if (data && data.return && Array.isArray(data.return)) {
        let flag = true;
        if (data.return.length > 0) {
            data.return.forEach(value => {
                if (typeof value !== 'string') {
                    flag = false;
                }
            });
        }
        if (flag === true) {
            return data.return;
        } else {
            return [];
        }
    } else {
        return [];
    }
}

export function getReturnFields4Db(data: any): any {
    if (data && data.return && Array.isArray(data.return)) {
        let flag = true;
        if (data.return.length > 0) {
            data.return.forEach((value, index) => {
                if (typeof value !== 'string') {
                    flag = false;
                }
                data.return[index] = Object.keys(sanitize4Db({[value]: 1}))[0];
            });
        }
        if (flag === true) {
            return data.return;
        } else {
            return [];
        }
    } else {
        return [];
    }
}

export function sanitizeWithOperator4Db(data: any) {
    // data = sanitize4Db(data);
    if (data === null || data === undefined) {
        return null;
    }
    if (data.filter && data.filter.id){
        data.filter._id = data.filter.id;
        delete data.filter.id;
    }
    if (data.id){
        data._id = data.id;
        delete data.id;
    }
    return data;
}

export function sanitize4Db(data: any) {
    // data = addCreateMetadata(data, null);
    if (data === null || data === undefined) {
        return null;
    }
    if (data && data.hasOwnProperty('return')) {
        delete data.return;
    }
    if (data && data.hasOwnProperty('id')) {
        data._id = data.id;
        delete data.id;
    }

    if (data && data.hasOwnProperty('_created_at')) {
        // data.createdAt = data._created_at;
        delete data._created_at;
    }

    if (data && data.hasOwnProperty('_updated_at')) {
        // data.updatedAt = data._updated_at;
        delete data._updated_at;
    }

    if (data && data.hasOwnProperty('_created_by')) {
        // data.createdBy = data._created_by;
        delete data._created_by;
    }
    return data;
}

export function sanitize4User(data: any, returnFields: string[]) {
    if (data === null || data === undefined) {
        return null;
    }
    if (data && data.hasOwnProperty('_id')) {
        data.id = data._id ? (typeof data._id === 'object' ? data._id : data._id.toString()) : '';
        delete data._id;
    }
    if (data && data.hasOwnProperty('_created_at')) {
        // data.createdAt = data._created_at;
        delete data._created_at;
    }
    if (data && data.hasOwnProperty('_updated_at')) {
        // data.updatedAt = data._updated_at;
        delete data._updated_at;
    }
    if (data && data.hasOwnProperty('_created_by')) {
        // data.createdBy = data?._created_by;
        delete data._created_by;
    }
    if (data && data.hasOwnProperty('_hashed_password')) {
        // if (!data.password) {
        //     data.password = data._hashed_password;
        // }
        delete data._hashed_password;
    }
    // if (data && data.hasOwnProperty('password')) {
        // if (!data.password) {
        //     data.password = data._hashed_password;
        // }
        // delete data.password;
    // }
    if (data && typeof data.hasOwnProperty('_rperm')) {
        delete data._rperm;
    }
    if (data && typeof data.hasOwnProperty('_wperm')) {
        delete data._wperm;
    }
    if (data && typeof data.hasOwnProperty('_acl')) {
        delete data._acl;
    }
    let returnedData: any = {};
    if (!Array.isArray(returnFields)) {
        return data;
    }
    if (Array.isArray(returnFields) && returnFields.length === 0) {
        return data;
    }
    if (Array.isArray(returnFields)) {
        returnFields.forEach(value => {
            returnedData[value] = data[value];
        });
        returnedData.id = data.id;
        returnedData.createdAt = data.createdAt;
        returnedData.updatedAt = data.updatedAt;
        return returnedData;
    }
    return data;
}

export function publishChanges(domain: string, change: ChangesModel, options: BFastOptions) {
    const aI = AppEventsFactory.getInstance();
    aI.pub(aI.eventName(options.projectId, domain), change);
}

export async function aggregate(
    table: string, pipelines: any[],
    writeOptions: DatabaseWriteOptions = {bypassDomainVerification: false},
    options: BFastOptions
): Promise<any> {
    await checkPolicyInDomain(table, writeOptions);
    const results = await _aggregate(table, pipelines, options);
    return results.map(result => sanitize4User(result, []));
}
