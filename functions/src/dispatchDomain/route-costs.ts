export interface RouteCostSettings {id:string;effectiveDate:string;expectedMileage:number;dieselPrice:number;driverDaily:number;reserve:number;reservePolicy:'vehicle_day'|'trip';driverPolicy:'vehicle_day'|'driver_day';marginBasisPoints:number;otherEstimated:number;createdAt?:string;revision?:number;}
export const DEFAULT_ROUTE_COSTS:RouteCostSettings={id:'default',effectiveDate:'1970-01-01',expectedMileage:15,dieselPrice:10000,driverDaily:50000,reserve:20000,reservePolicy:'vehicle_day',driverPolicy:'vehicle_day',marginBasisPoints:1500,otherEstimated:0};
export function validateRouteCosts(value:RouteCostSettings):RouteCostSettings {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value.effectiveDate)||new Date(value.effectiveDate+'T00:00:00Z').toISOString().slice(0,10)!==value.effectiveDate)throw new Error('Valid effective date required');
 if(!Number.isFinite(value.expectedMileage)||value.expectedMileage<=0||value.expectedMileage>100)throw new Error('Expected mileage must be 0–100 km/L');
 for(const key of ['dieselPrice','driverDaily','reserve','otherEstimated'] as const)if(!Number.isSafeInteger(value[key])||value[key]<0||value[key]%100!==0||value[key]>100000000)throw new Error('Cost assumptions must be non-negative whole rupees');
 if(!Number.isInteger(value.marginBasisPoints)||value.marginBasisPoints<=0||value.marginBasisPoints>10000)throw new Error('Margin must be greater than 0% and at most 100%');
 if(!['vehicle_day','trip'].includes(value.reservePolicy)||!['vehicle_day','driver_day'].includes(value.driverPolicy))throw new Error('Select the daily cost allocation policy');
 return{id:value.id,effectiveDate:value.effectiveDate,expectedMileage:value.expectedMileage,dieselPrice:value.dieselPrice,driverDaily:value.driverDaily,reserve:value.reserve,reservePolicy:value.reservePolicy,driverPolicy:value.driverPolicy,marginBasisPoints:value.marginBasisPoints,otherEstimated:value.otherEstimated};
}
export const roundedCost=(paise:number)=>Math.round(paise/100)*100;
export function estimatedRouteCost(km:number|null,sales:number,settings:RouteCostSettings,driverAllocation:number,reserveAllocation:number){
 const litres=km===null?null:km/settings.expectedMileage,fuel=litres===null?null:roundedCost(litres*settings.dieselPrice),expenses=fuel===null?null:fuel+driverAllocation+reserveAllocation+settings.otherEstimated;
 const grossProfit=roundedCost(sales*settings.marginBasisPoints/10000);
 return{estimatedLitres:litres,estimatedFuel:fuel,estimatedExpense:expenses,estimatedGrossProfit:grossProfit,estimatedContribution:expenses===null?null:grossProfit-expenses,breakEvenSales:expenses===null?null:Math.ceil(expenses/settings.marginBasisPoints*10000/100)*100};
}
export function settingsForDate(settings:RouteCostSettings[],date:string){return settings.filter(s=>s.effectiveDate<=date).sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate)||(b.createdAt??'').localeCompare(a.createdAt??''))[0]??DEFAULT_ROUTE_COSTS;}
export function allocateRouteOverhead<T extends {id:string;date:string;vehicleId:string;primaryDriverId:string;companionId:string|null;startedAt:string|null}>(trips:T[],costs:(trip:T)=>RouteCostSettings){
 const vehicles=new Set<string>(),drivers=new Set<string>(),result=new Map<string,{driver:number;reserve:number}>();
 for(const trip of [...trips].sort((a,b)=>a.date.localeCompare(b.date)||Number(!a.startedAt)-Number(!b.startedAt)||a.id.localeCompare(b.id))){
  const c=costs(trip),vehicleDay=trip.vehicleId+':'+trip.date,crew=[trip.primaryDriverId,...(trip.companionId?[trip.companionId]:[])];
  const driver=c.driverPolicy==='vehicle_day'?(vehicles.has(vehicleDay)?0:c.driverDaily):crew.filter(id=>!drivers.has(id+':'+trip.date)).length*c.driverDaily;
  result.set(trip.id,{driver,reserve:c.reservePolicy==='trip'||!vehicles.has(vehicleDay)?c.reserve:0});vehicles.add(vehicleDay);for(const id of crew)drivers.add(id+':'+trip.date);
 }return result;
}
