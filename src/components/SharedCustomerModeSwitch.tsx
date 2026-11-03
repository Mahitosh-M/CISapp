import {useState,type FormEvent} from 'react';
import {useSharedCustomerMode} from '../contexts/SharedCustomerModeContext';
import './SharedCustomerModeSwitch.css';
export default function SharedCustomerModeSwitch(){
 const context=useSharedCustomerMode();
 const [open,setOpen]=useState(false),[password,setPassword]=useState(''),[error,setError]=useState('');
 if(!context)return null;
 const close=()=>{setOpen(false);setPassword('');setError('');};
 const submit=(event:FormEvent)=>{event.preventDefault();if(context.leaveMedical(password))close();else{setPassword('');setError('Incorrect password.');}};
 return <>
  <button type="button" className="shared-medical-switch" aria-pressed={context.mode==='medical'} onClick={()=>{if(context.mode==='medical'){setOpen(true);setPassword('');setError('');}else context.enterMedical();}}>Medical</button>
  <span className="shared-mode-label">{context.mode==='medical'?'MEDICAL':'Customers'}</span>
  {open&&<div className="shared-mode-backdrop" onKeyDown={event=>{if(event.key==='Escape')close();}}><form data-enter-navigation="native" role="dialog" aria-modal="true" aria-labelledby="shared-mode-password-title" onSubmit={submit} className="shared-mode-dialog">
   <h2 id="shared-mode-password-title">Switch to Customers</h2>
   <label>Password<input autoFocus type="password" inputMode="numeric" autoComplete="off" value={password} onChange={event=>setPassword(event.target.value)} required/></label>
   {error&&<p role="alert">{error}</p>}
   <div><button type="button" onClick={close}>Cancel</button><button type="submit">Switch to Customers</button></div>
  </form></div>}
 </>;
}
