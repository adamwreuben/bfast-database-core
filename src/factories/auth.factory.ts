import {AuthAdapter} from '../adapters/auth.adapter';
import {BasicUser} from '../models/basic-user';
import {BFastOptions} from "../bfast-option";
import {findByFilter, writeOneDataInStore} from "../controllers/database.controller";

import {comparePlainTextWithSaltedHash, generateToken, saltHashPlainText} from "../controllers/security";
import {RuleContext} from "../models/rule-context";

export class AuthFactory implements AuthAdapter {
    private domainName = '_User';

    // async resetPassword(email: string, context?: RuleContext): Promise<any> {
    //     return undefined;
    // }

    async signIn<T extends BasicUser>(
        userModel: T, context: RuleContext, options: BFastOptions
    ): Promise<T> {
        const queryModel = {filter: {username: userModel.username}, return: []}
        const wOptions = {bypassDomainVerification: true}
        const users = await findByFilter(this.domainName, queryModel, context, wOptions, options);
        if (users && Array.isArray(users) && users.length === 1) {
            const user = users[0];
            if (await comparePlainTextWithSaltedHash(userModel.password, user.password ? user.password : user._hashed_password)) {
                delete user.password;
                delete user._hashed_password;
                delete user._acl;
                delete user._rperm;
                delete user._wperm;
                user.token = await generateToken({uid: user.id}, options);
                return user;
            } else {
                throw new Error('Password is not valid');
            }
        } else {
            // console.log(users);
            throw new Error('Username is not valid');
        }
    }

    async signUp<T extends BasicUser>(
        userModel: T, context: RuleContext, options: BFastOptions
    ): Promise<T> {
        const wOptions = {bypassDomainVerification: true}
        userModel.password = await saltHashPlainText(userModel?.password);
        const user = await writeOneDataInStore(
            this.domainName, userModel, context, wOptions, options
        );
        delete user.password;
        user.token = await generateToken({uid: user.id}, options);
        return user;
    }

    // async sendVerificationEmail(email: string, context?: RuleContext): Promise<any> {
    //     return undefined;
    // }
    //
    // async updateUserInStore<T extends BasicUser>(
    //     userModel: T,
    //     context: RuleContext,
    //     options: BFastOptions
    // ): Promise<{ message: string, modified: number }> {
    //     return updateDataInStore(
    //         this.domainName,
    //         {
    //             id: context.uid,
    //             upsert: false,
    //             update: {
    //                 $set: userModel
    //             }
    //         },
    //         context,
    //         {bypassDomainVerification: true},
    //         options
    //     );
    // }
    //
    // async updatePassword(
    //     password: string,
    //     context: RuleContext,
    //     options: BFastOptions
    // ): Promise<any> {
    //     const hashedPassword = await saltHashPlainText(password);
    //     return updateDataInStore(
    //         this.domainName,
    //         {
    //             id: context.uid,
    //             update: {
    //                 $set: {
    //                     password: hashedPassword
    //                 }
    //             }
    //         },
    //         context,
    //         {bypassDomainVerification: true},
    //         options
    //     );
    // }
}
