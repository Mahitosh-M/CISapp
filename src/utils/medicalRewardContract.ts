export interface MedicalRewardQuoteRequest {
 customerId:string; invoiceId?:string; salesAmount:number; costAmount:number; transportAmount:number; manualTroikaaCoins:number;
}
export interface MedicalRewardQuoteResponse {
 maximumAllowedCoins:number;levelRewardCoins:number;finalCombinedRewardCoins:number;valid:boolean;message:string;locked:boolean;
}
