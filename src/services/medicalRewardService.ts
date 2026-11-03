import {connectFunctionsEmulator,getFunctions,httpsCallable} from 'firebase/functions';
import {app} from '../firebase';
import type {MedicalRewardQuoteRequest,MedicalRewardQuoteResponse} from '../utils/medicalRewardContract';
const functions=getFunctions(app,'asia-south1');
const emulator=import.meta.env.VITE_FUNCTIONS_EMULATOR_URL;
if(emulator){const url=new URL(emulator);connectFunctionsEmulator(functions,url.hostname,Number(url.port));}
export const quoteMedicalReward=async(input:MedicalRewardQuoteRequest)=>(await httpsCallable<MedicalRewardQuoteRequest,MedicalRewardQuoteResponse>(functions,'quoteMedicalInvoiceReward')(input)).data;
export const postMedicalReward=async(invoiceId:string)=>(await httpsCallable<{invoiceId:string},{invoiceId:string;status:'not_fully_paid'|'not_eligible'|'already_finalized'|'credited'|'finalized_zero';points:number;availablePc?:number}>(functions,'postMedicalInvoiceReward')({invoiceId})).data;
