// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import TroikaaCoins from './TroikaaCoins';
const quote=vi.hoisted(()=>vi.fn());
vi.mock('../services/medicalRewardService',()=>({quoteMedicalReward:quote}));
const input={customerId:'med',salesAmount:10000,costAmount:8000,transportAmount:0,manualTroikaaCoins:0};
afterEach(()=>{cleanup();vi.resetAllMocks();});
describe('TROIKAA invoice panel',()=>{
 it.each(['customer','header','Medical','',undefined])('hides the button for type %s',customerType=>{render(<TroikaaCoins customerType={customerType} input={input} onChange={()=>{}}/>);expect(screen.queryByRole('button',{name:'TROIKAA Coins'})).not.toBeInTheDocument();});
 it('shows Medical-only derived limits, accepts a total proposal and sends changed amounts for recalculation',async()=>{
  quote.mockResolvedValue({maximumAllowedCoins:160,levelRewardCoins:40,finalCombinedRewardCoins:40,valid:true,message:'',locked:false});const onChange=vi.fn();
  const view=render(<TroikaaCoins customerType="medical" input={input} onChange={onChange}/>);fireEvent.click(screen.getByRole('button',{name:'TROIKAA Coins'}));await screen.findByText('Maximum allowed total coins');expect(screen.getByText('160')).toBeInTheDocument();expect(view.container.textContent).not.toMatch(/2000|8000|gross profit|purchase cost|profit margin/i);
  fireEvent.change(screen.getByLabelText('Manual TROIKAA coins'),{target:{value:'100'}});expect(onChange).toHaveBeenLastCalledWith(100);
  view.rerender(<TroikaaCoins customerType="medical" input={{...input,costAmount:9000,manualTroikaaCoins:100}} onChange={onChange}/>);await waitFor(()=>expect(quote).toHaveBeenLastCalledWith({...input,costAmount:9000,manualTroikaaCoins:100}));
 });
 it('displays the specific cap validation and does not show an invalid proposal as final',async()=>{
  quote.mockResolvedValue({maximumAllowedCoins:160,levelRewardCoins:40,finalCombinedRewardCoins:200,valid:false,message:'Maximum allowed reward for this invoice is 160 coins.',locked:false});render(<TroikaaCoins customerType="medical" input={{...input,manualTroikaaCoins:200}} onChange={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'TROIKAA Coins'}));expect(await screen.findByRole('alert')).toHaveTextContent('160 coins');expect(screen.getByText('Revise proposal')).toBeInTheDocument();
 });
 it('discards a stale response when invoice amounts change',async()=>{
  let release!:(value:unknown)=>void;quote.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockResolvedValue({maximumAllowedCoins:80,levelRewardCoins:20,finalCombinedRewardCoins:20,valid:true,message:'',locked:false});const view=render(<TroikaaCoins customerType="medical" input={input} onChange={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'TROIKAA Coins'}));await waitFor(()=>expect(quote).toHaveBeenCalledTimes(1));view.rerender(<TroikaaCoins customerType="medical" input={{...input,costAmount:9000}} onChange={()=>{}}/>);await screen.findByText('80');release({maximumAllowedCoins:160,levelRewardCoins:40,finalCombinedRewardCoins:40,valid:true,message:'',locked:false});await waitFor(()=>expect(screen.queryByText('160')).not.toBeInTheDocument());
 });
});
