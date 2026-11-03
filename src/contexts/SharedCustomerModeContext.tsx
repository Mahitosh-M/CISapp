import {createContext,useContext,useState,type ReactNode} from 'react';
import {SHARED_CUSTOMER_MODE_PREFIX,type SharedCustomerMode} from '../utils/sharedCustomerMode';
interface ModeContext {mode:SharedCustomerMode;enterMedical:()=>void;leaveMedical:(password:string)=>boolean;}
// Only the shared Staff/Admin layout supplies this context. Other pages keep their existing behavior.
export const SharedCustomerModeContext=createContext<ModeContext|undefined>(undefined);
export const useSharedCustomerMode=()=>useContext(SharedCustomerModeContext);
export function SharedCustomerModeProvider({userId,children}:{userId:string;children:ReactNode}){
 const storageKey=SHARED_CUSTOMER_MODE_PREFIX+userId;
 const [mode,setMode]=useState<SharedCustomerMode>(()=>{try{return sessionStorage.getItem(storageKey)==='medical'?'medical':'customer';}catch{return 'customer';}});
 const changeMode=(value:SharedCustomerMode)=>{setMode(value);try{sessionStorage.setItem(storageKey,value);}catch{/* Keep the mode for this mounted session. */}};
 return <SharedCustomerModeContext.Provider value={{mode,enterMedical:()=>changeMode('medical'),leaveMedical:(password)=>{if(password!=='1122')return false;changeMode('customer');return true;}}}>{children}</SharedCustomerModeContext.Provider>;
}
